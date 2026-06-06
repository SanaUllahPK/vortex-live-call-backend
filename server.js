import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";

const app = express();
app.use(express.json());
app.use(cors());

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

// SUPABASE CLIENT
const supabase = createClient(
  process.env.SUPABASE_PROJECT_URL,
  process.env.SUPABASE_ANON_KEY
);

// SUPABASE ADMIN CLIENT (for writes)
const supabaseAdmin = createClient(
  process.env.SUPABASE_PROJECT_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GOOGLE SHEETS CLIENT
const sheets = google.sheets({ version: "v4", auth: new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
})});

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// ════════════════════════════════════════
// PRIORITY 1: LOAD SUPPLIER PROFILE
// ════════════════════════════════════════

app.post("/api/supplier/load", async (req, res) => {
  try {
    const { supplier_id } = req.body;

    if (!supplier_id) {
      return res.status(400).json({ error: "supplier_id required" });
    }

    // Load supplier from Supabase
    const { data: supplier, error: supplierError } = await supabase
      .from("suppliers")
      .select("*")
      .eq("supplier_id", supplier_id)
      .single();

    if (supplierError) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    // Load contacts for this supplier
    const { data: contacts } = await supabase
      .from("contacts")
      .select("*")
      .eq("supplier_id", supplier_id);

    // Load recent interactions
    const { data: interactions } = await supabase
      .from("interactions")
      .select("*")
      .eq("supplier_id", supplier_id)
      .order("interaction_date", { ascending: false })
      .limit(5);

    // Load promised actions
    const { data: promises } = await supabase
      .from("promised_actions")
      .select("*")
      .eq("supplier_id", supplier_id)
      .eq("completed", false);

    // Parse known information from supplier record
    const knownInfo = {
      moq: supplier.moq || null,
      approval_timeline: supplier.approval_timeline || null,
      required_documents: supplier.required_documents || null,
      payment_terms: supplier.payment_terms || null,
      shipping_policy: supplier.shipping_policy || null,
      catalog: supplier.catalog_available || null
    };

    // Determine missing information
    const missingInfo = [];
    if (!knownInfo.moq) missingInfo.push("MOQ");
    if (!knownInfo.approval_timeline) missingInfo.push("Approval Timeline");
    if (!knownInfo.required_documents) missingInfo.push("Required Documents");
    if (!knownInfo.payment_terms) missingInfo.push("Payment Terms");
    if (!knownInfo.shipping_policy) missingInfo.push("Shipping Policy");
    if (!knownInfo.catalog) missingInfo.push("Catalog");

    res.json({
      supplier: {
        supplier_id: supplier.supplier_id,
        company_name: supplier.company_name,
        relationship_status: supplier.relationship_status,
        approval_likelihood: supplier.approval_likelihood,
        last_contact_date: supplier.last_contact_date,
        next_follow_up_date: supplier.next_follow_up_date,
        notes: supplier.notes
      },
      primary_contact: contacts?.[0] || null,
      all_contacts: contacts || [],
      known_information: knownInfo,
      missing_information: missingInfo,
      recent_interactions: interactions || [],
      open_promises: promises || []
    });
  } catch (error) {
    console.error("Error loading supplier:", error);
    res.status(500).json({ error: "Failed to load supplier" });
  }
});

// ════════════════════════════════════════
// PRIORITY 2: AUTO CALL SUMMARY & SAVE
// ════════════════════════════════════════

app.post("/api/interaction/save", async (req, res) => {
  try {
    const {
      supplier_id,
      contact_id,
      transcript,
      duration_minutes,
      call_outcome,
      objections_raised,
      next_step,
      follow_up_date
    } = req.body;

    if (!supplier_id || !transcript) {
      return res.status(400).json({ error: "supplier_id and transcript required" });
    }

    // Generate call summary using Claude
    const summaryMessage = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `Analyze this call transcript and generate a professional summary.

TRANSCRIPT:
${transcript}

Generate ONLY JSON (no markdown, no backticks):
{
  "summary": "2-3 sentence summary of the call",
  "key_discoveries": ["discovery 1", "discovery 2", "discovery 3"],
  "objections": ["objection 1", "objection 2"],
  "next_steps": ["action 1", "action 2"],
  "sentiment": "positive/neutral/negative",
  "call_outcome": "${call_outcome || 'Follow Up'}"
}`
        }
      ]
    });

    let callSummary;
    try {
      const jsonText = summaryMessage.content[0].type === "text" 
        ? summaryMessage.content[0].text 
        : "{}";
      callSummary = JSON.parse(jsonText);
    } catch {
      callSummary = {
        summary: "Call completed",
        key_discoveries: [],
        objections: [],
        next_steps: [next_step || "Follow up"],
        sentiment: "neutral",
        call_outcome: call_outcome || "Follow Up"
      };
    }

    // Create interaction record
    const interaction_id = `INT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const { error: insertError } = await supabaseAdmin
      .from("interactions")
      .insert({
        interaction_id,
        supplier_id,
        contact_id,
        interaction_date: new Date().toISOString().split('T')[0],
        interaction_type: "call",
        duration_minutes,
        summary: callSummary.summary,
        transcript,
        objections_raised: callSummary.objections?.join(", "),
        next_action: callSummary.next_steps?.join(", "),
        next_follow_up_date: follow_up_date,
        call_sentiment: callSummary.sentiment,
        notes: JSON.stringify(callSummary)
      });

    if (insertError) {
      return res.status(500).json({ error: "Failed to save interaction", details: insertError });
    }

    // Update supplier
    const { error: updateError } = await supabaseAdmin
      .from("suppliers")
      .update({
        last_contact_date: new Date().toISOString().split('T')[0],
        next_follow_up_date: follow_up_date,
        relationship_status: callSummary.call_outcome,
        total_interactions: new Date().getTime() // Placeholder for increment
      })
      .eq("supplier_id", supplier_id);

    // If approval_likelihood should be updated based on discoveries
    if (callSummary.key_discoveries?.length > 0) {
      const discoveryCount = callSummary.key_discoveries.length;
      let newLikelihood = "Low";
      if (discoveryCount >= 4) newLikelihood = "High";
      else if (discoveryCount >= 2) newLikelihood = "Medium";

      await supabaseAdmin
        .from("suppliers")
        .update({ approval_likelihood: newLikelihood })
        .eq("supplier_id", supplier_id);
    }

    // Create promised actions if any
    if (callSummary.next_steps && callSummary.next_steps.length > 0) {
      const promisedActions = callSummary.next_steps.map((step, idx) => ({
        action_id: `ACT_${Date.now()}_${idx}`,
        interaction_id,
        supplier_id,
        action_description: step,
        promised_by_date: follow_up_date || new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0],
        status: "pending"
      }));

      await supabaseAdmin
        .from("promised_actions")
        .insert(promisedActions);
    }

    res.json({
      interaction_id,
      summary: callSummary.summary,
      key_discoveries: callSummary.key_discoveries,
      objections: callSummary.objections,
      next_steps: callSummary.next_steps,
      call_outcome: callSummary.call_outcome,
      follow_up_date
    });
  } catch (error) {
    console.error("Error saving interaction:", error);
    res.status(500).json({ error: "Failed to save interaction", details: error.message });
  }
});

// ════════════════════════════════════════
// PRIORITY 3: GOOGLE SHEETS SYNC
// ════════════════════════════════════════

app.post("/api/sheets/sync-suppliers", async (req, res) => {
  try {
    // Load all suppliers from Supabase
    const { data: suppliers } = await supabase
      .from("suppliers")
      .select("*")
      .order("last_updated", { ascending: false });

    if (!suppliers) {
      return res.status(400).json({ error: "No suppliers found" });
    }

    // Format for Google Sheets
    const rows = suppliers.map(s => [
      s.supplier_id,
      s.company_name,
      s.website || "",
      s.category || "",
      s.subcategory || "",
      s.relationship_status || "New",
      s.approval_likelihood || "Low",
      s.last_contact_date || "",
      s.next_follow_up_date || "",
      s.total_interactions || 0,
      s.notes || ""
    ]);

    // Write to Google Sheets
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: "SUPPLIERS!A2:K1000",
      valueInputOption: "RAW",
      resource: {
        values: rows
      }
    });

    res.json({ success: true, rows_synced: rows.length });
  } catch (error) {
    console.error("Error syncing to sheets:", error);
    res.status(500).json({ error: "Failed to sync to sheets" });
  }
});

// ════════════════════════════════════════
// PRIORITY 4: GET ALL SUPPLIERS (Dashboard)
// ════════════════════════════════════════

app.get("/api/suppliers/dashboard", async (req, res) => {
  try {
    const { status, sort } = req.query;

    let query = supabase
      .from("suppliers")
      .select("supplier_id, company_name, relationship_status, approval_likelihood, last_contact_date, next_follow_up_date, total_interactions");

    if (status) {
      query = query.eq("relationship_status", status);
    }

    const { data: suppliers } = await query.order(
      sort === "follow_up" ? "next_follow_up_date" : "last_contact_date",
      { ascending: false }
    );

    // Get missing info for each supplier
    const suppliersWithMissing = await Promise.all(
      suppliers.map(async (s) => {
        const missingInfo = [];
        if (!s.moq) missingInfo.push("MOQ");
        if (!s.approval_timeline) missingInfo.push("Timeline");
        if (!s.required_documents) missingInfo.push("Docs");
        if (!s.payment_terms) missingInfo.push("Payment");
        if (!s.shipping_policy) missingInfo.push("Shipping");
        
        return {
          ...s,
          missing_count: missingInfo.length,
          missing_info: missingInfo.join(", ")
        };
      })
    );

    res.json({
      suppliers: suppliersWithMissing,
      total: suppliersWithMissing.length
    });
  } catch (error) {
    console.error("Error loading dashboard:", error);
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

// ════════════════════════════════════════
// LIVE CALL COPILOT (existing)
// ════════════════════════════════════════

app.post("/api/analyze-live", async (req, res) => {
  try {
    const { transcript, conversationHistory, brief, callType, supplierProfile } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: "Transcript required" });
    }

    let context = "";
    if (conversationHistory && conversationHistory.length > 0) {
      context = "Conversation so far:\n";
      conversationHistory.forEach(item => {
        context += `${item.speaker === 'contact' ? 'Contact' : 'Sanaullah'}: ${item.text}\n`;
      });
      context += "\n";
    }

    // Add supplier memory to context
    let memoryContext = "";
    if (supplierProfile) {
      memoryContext = `SUPPLIER MEMORY:
Supplier: ${supplierProfile.company_name}
Status: ${supplierProfile.relationship_status}
Known: ${Object.entries(supplierProfile.known_information)
  .filter(([k, v]) => v)
  .map(([k, v]) => `${k}: ${v}`)
  .join(", ") || "None yet"}
Missing: ${supplierProfile.missing_information.join(", ") || "All collected"}

RULE: Do not ask about known information. Prioritize discovering missing information.
When enough information is gathered, stop asking questions. Summarize and confirm next steps.

`;
    }

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `${memoryContext}
${context}Contact just said: "${transcript}"

You are Sanaullah's live call copilot.
Your ONLY job: Tell him what to say next.

RULES:
1. Answer their question first (never dodge)
2. Do NOT repeat information already known
3. Prioritize discovering MISSING information
4. When enough info is collected, STOP asking questions
5. Instead: Summarize what was learned, confirm next steps, close professionally
6. Sound like a real person, not a script

OUTPUT ONLY:

SAY NOW:
[Exact words Sanaullah should say]`
        }
      ]
    });

    const guidance = message.content[0].type === "text" ? message.content[0].text : "";

    res.json({ guidance });
  } catch (error) {
    console.error("Claude API error:", error);
    res.status(500).json({ error: "Failed to generate response" });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Vortex Integrated System" });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ Vortex Integrated System running on port ${PORT}`);
});
