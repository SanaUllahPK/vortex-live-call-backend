import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());
app.use(cors());

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

// SUPABASE CLIENT
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// SUPABASE ADMIN CLIENT
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ════════════════════════════════════════
// PRIORITY 4: GET ALL SUPPLIERS (Dashboard)
// ════════════════════════════════════════

app.get("/api/suppliers/dashboard", async (req, res) => {
  try {
    const { status, sort } = req.query;

    const { data: suppliers, error } = await supabase
      .from("suppliers")
      .select("id, name, contact, email, phone, moq, lead_time, brands");

    if (error) {
      return res.status(500).json({ error: "Failed to load suppliers", details: error.message });
    }

    // Format for frontend
    const formattedSuppliers = (suppliers || []).map(s => ({
      supplier_id: String(s.id),
      company_name: s.name,
      contact_name: s.contact,
      email: s.email,
      phone: s.phone,
      moq: s.moq,
      lead_time: s.lead_time,
      brands: s.brands,
      relationship_status: "New",
      approval_likelihood: "Low",
      last_contact_date: null,
      next_follow_up_date: null,
      total_interactions: 0,
      missing_count: 6,
      missing_info: "MOQ, Timeline, Docs, Payment, Shipping, Catalog"
    }));

    res.json({
      suppliers: formattedSuppliers,
      total: formattedSuppliers.length
    });
  } catch (error) {
    console.error("Error loading dashboard:", error);
    res.status(500).json({ error: "Failed to load dashboard", details: error.message });
  }
});

// ════════════════════════════════════════
// PRIORITY 1: LOAD SUPPLIER PROFILE
// ════════════════════════════════════════

app.post("/api/supplier/load", async (req, res) => {
  try {
    const { supplier_id } = req.body;

    if (!supplier_id) {
      return res.status(400).json({ error: "supplier_id required" });
    }

    // Load supplier
    const { data: supplier, error: supplierError } = await supabase
      .from("suppliers")
      .select("*")
      .eq("id", parseInt(supplier_id))
      .single();

    if (supplierError) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    // Load contacts
    const { data: contacts } = await supabase
      .from("contacts")
      .select("*")
      .eq("supplier_id", supplier_id);

    // Load interactions
    const { data: interactions } = await supabase
      .from("interactions")
      .select("*")
      .eq("supplier_id", supplier_id)
      .order("interaction_date", { ascending: false })
      .limit(5);

    // Parse known info
    const knownInfo = {
      moq: supplier.moq || null,
      lead_time: supplier.lead_time || null,
      payment_terms: supplier.payment_terms || null
    };

    const missingInfo = [];
    if (!knownInfo.moq) missingInfo.push("MOQ");
    if (!knownInfo.lead_time) missingInfo.push("Lead Time");
    if (!knownInfo.payment_terms) missingInfo.push("Payment Terms");

    res.json({
      supplier: {
        supplier_id: String(supplier.id),
        company_name: supplier.name,
        contact: supplier.contact,
        email: supplier.email,
        phone: supplier.phone,
        relationship_status: "New",
        approval_likelihood: "Low"
      },
      primary_contact: contacts?.[0] || null,
      all_contacts: contacts || [],
      known_information: knownInfo,
      missing_information: missingInfo,
      recent_interactions: interactions || []
    });
  } catch (error) {
    console.error("Error loading supplier:", error);
    res.status(500).json({ error: "Failed to load supplier", details: error.message });
  }
});

// ════════════════════════════════════════
// LIVE CALL COPILOT
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

    let memoryContext = "";
    if (supplierProfile) {
      memoryContext = `SUPPLIER MEMORY:
Supplier: ${supplierProfile.supplier.company_name}
Contact: ${supplierProfile.supplier.contact}
Status: ${supplierProfile.supplier.relationship_status}

Known: ${Object.entries(supplierProfile.known_information || {})
  .filter(([k, v]) => v)
  .map(([k, v]) => `${k}: ${v}`)
  .join(", ") || "Nothing yet"}

Missing: ${(supplierProfile.missing_information || []).join(", ") || "All collected"}

RULES:
- Do NOT repeat information already known
- Prioritize discovering MISSING information
- When enough info collected, STOP asking questions
- Summarize and confirm next steps

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
    res.status(500).json({ error: "Failed to generate response", details: error.message });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
