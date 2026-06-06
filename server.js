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

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const supplierMemory = new Map();

const normalizeSupplierName = (name) => {
  if (!name) return null;
  return name.toLowerCase().replace(/\b(llc|inc|corp|co|ltd|company|inc\.|co\.|llc\.|distributor|dist|distribution|distributors)\b/g, "").replace(/\s+/g, " ").trim();
};

const findOrCreateSupplier = async (companyName, supplierId = null) => {
  const normalized = normalizeSupplierName(companyName);
  if (!normalized) return null;
  try {
    const { data: variantMatch } = await supabase.from("supplier_name_variants").select("canonical_supplier_id").eq("normalized_version", normalized).gte("confidence", 90).limit(1);
    if (variantMatch && variantMatch.length > 0) return variantMatch[0].canonical_supplier_id;
    const { data: exactMatch } = await supabase.from("supplier_memory").select("id").eq("company_name", companyName).limit(1);
    if (exactMatch && exactMatch.length > 0) return exactMatch[0].id;
    const { data: newSupplier, error: createError } = await supabase.from("supplier_memory").insert([{company_name: companyName, normalized_name: normalized, supplier_id: supplierId || null,}]).select().single();
    if (createError) {console.error("Error creating supplier:", createError); return null;}
    await supabase.from("supplier_name_variants").insert([{canonical_supplier_id: newSupplier.id, variant_name: companyName, normalized_version: normalized, confidence: 100}]);
    return newSupplier.id;
  } catch (error) {console.error("Identity resolution error:", error); return null;}
};

const loadSupplierMemory = async (supplierUuid) => {
  if (!supplierUuid) return null;
  try {
    if (supplierMemory.has(supplierUuid)) return supplierMemory.get(supplierUuid);
    const { data, error } = await supabase.from("supplier_memory").select("*").eq("id", supplierUuid).single();
    if (error) return null;
    supplierMemory.set(supplierUuid, data);
    return data;
  } catch (error) {return null;}
};

const updateSupplierMemoryFull = async (supplierUuid, updates) => {
  if (!supplierUuid) return null;
  try {
    const safeUpdates = { ...updates };
    safeUpdates.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from("supplier_memory").update(safeUpdates).eq("id", supplierUuid).select().single();
    if (error) return null;
    supplierMemory.set(supplierUuid, data);
    return data;
  } catch (error) {return null;}
};

const SYSTEM_PROMPT = `
You are a Supplier Intelligence Analyst for Vortex Origin Brands (a legitimate wholesale buyer).

YOUR ROLE:
Analyze supplier conversations and provide business intelligence to help Vortex evaluate and manage supplier relationships. You provide analysis and recommendations - the user decides what to do.

YOU DO NOT:
- Generate scripts or tell the user what to say
- Impersonate or negotiate on behalf of Vortex
- Make commitments on behalf of Vortex
- Suggest false or deceptive claims

YOU DO:
- Identify information collected and missing
- Detect objections, risks, and red flags
- Identify trust and relationship signals
- Recommend professional discovery questions
- Recommend next objectives based on business logic
- Provide business intelligence

FOR EACH SUPPLIER MESSAGE, PROVIDE ANALYSIS:

**CURRENT STAGE:** [Where in the relationship are we? Prospect → Contact → Interested → Approved]
**TRUST LEVEL:** [Estimated 1-10 based on signals]
**COLLECTED:** [✓ What information did we learn?]
**MISSING:** [□ What critical info is still unknown?]
**RISK FLAGS:** [Any red flags or concerns?]
**SUPPLIER SIGNALS:** [Positive/negative indicators from supplier]
**NEXT OBJECTIVE:** [What's the highest priority next step?]
**RECOMMENDED DISCOVERY QUESTIONS:** [2-3 professional questions to ask]
**FOLLOW-UP AREAS:** [What areas to explore further?]

Be analytical, professional, and focused on business decision-making.
`;

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Vortex Supplier Intelligence Platform v14 - Active" });
});

app.post("/api/analyze-supplier-message", async (req, res) => {
  try {
    const { supplierId, companyName, supplierMessage, conversationHistory } = req.body;
    
    if (!supplierMessage) {
      return res.status(400).json({ error: "Supplier message required" });
    }

    let supplierUuid = null;
    let memory = null;

    if (supplierId || companyName) {
      supplierUuid = await findOrCreateSupplier(companyName, supplierId);
      if (supplierUuid) {
        memory = await loadSupplierMemory(supplierUuid);
      }
    }

    const memoryContext = memory ? `EXISTING SUPPLIER MEMORY:\n${JSON.stringify(memory, null, 2)}` : "No prior memory for this supplier.";
    
    const historyContext = conversationHistory && conversationHistory.length > 0 
      ? `CONVERSATION SO FAR:\n${conversationHistory.map(item => `${item.speaker === 'you' ? 'VORTEX' : 'SUPPLIER'}: ${item.text}`).join('\n')}`
      : "First message from supplier.";

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `${SYSTEM_PROMPT}

${memoryContext}

${historyContext}

LATEST SUPPLIER MESSAGE: "${supplierMessage}"

Provide intelligence analysis in the format specified.`
      }]
    });

    const analysis = message.content[0].type === "text" ? message.content[0].text : "";

    if (supplierUuid && memory) {
      await updateSupplierMemoryFull(supplierUuid, {
        last_contact_date: new Date().toISOString(),
        interaction_history: [
          ...(memory.interaction_history || []),
          {
            date: new Date().toISOString().split('T')[0],
            message: supplierMessage,
            analysis: analysis.substring(0, 500)
          }
        ].slice(-20)
      });
    }

    res.json({ 
      analysis,
      timestamp: new Date().toISOString(),
      companyName,
      supplierId: supplierUuid
    });
  } catch (error) {
    console.error("Analysis error:", error);
    res.status(500).json({ error: "Failed to analyze message", details: error.message });
  }
});

app.post("/api/call-summary", async (req, res) => {
  try {
    const { conversationHistory, callType, supplierId, companyName } = req.body;

    if (!conversationHistory || conversationHistory.length === 0) {
      return res.status(400).json({ error: "Conversation history required" });
    }

    let transcript = "";
    conversationHistory.forEach(item => {
      transcript += `${item.speaker === 'contact' ? 'SUPPLIER' : 'VORTEX'}: ${item.text}\n\n`;
    });

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{
        role: "user",
        content: `Analyze this complete supplier conversation and provide a summary. Return JSON.

${transcript}

Provide JSON with:
{
  "call_type": "${callType}",
  "overall_assessment": "brief summary",
  "information_collected": ["list of key info gathered"],
  "critical_gaps": ["what's still unknown"],
  "risk_flags": ["any concerns"],
  "positive_signals": ["encouraging indicators"],
  "recommended_next_steps": ["2-3 specific actions"],
  "trust_assessment": 1-10,
  "relationship_stage": "Prospect|Contact|Interested|Approved"
}`
      }]
    });

    const responseText = message.content[0].type === "text" ? message.content[0].text : "{}";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const summary = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    if (supplierId || companyName) {
      const supplierUuid = await findOrCreateSupplier(companyName, supplierId);
      if (supplierUuid) {
        await updateSupplierMemoryFull(supplierUuid, {
          last_call_summary: summary,
          relationship_stage: summary.relationship_stage,
          trust_score: summary.trust_assessment,
          last_contact_date: new Date().toISOString()
        });
      }
    }

    res.json(summary);
  } catch (error) {
    console.error("Analysis error:", error);
    res.status(500).json({ error: "Failed to analyze call", details: error.message });
  }
});

app.get("/api/learning/questions", async (req, res) => {
  try {
    const { data } = await supabase.from('question_tracking').select('*').gte('sample_size', 5).order('effectiveness_score', { ascending: false }).limit(20);
    res.json({high_effectiveness_questions: data || [], count: (data || []).length});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ Vortex Supplier Intelligence Platform v14 running on port ${PORT}`);
  console.log(`✓ Mode: Analysis-Based Intelligence Platform`);
  console.log(`✓ NOT a sales script generator`);
  console.log(`✓ Endpoints: /api/analyze-supplier-message, /api/call-summary`);
});
