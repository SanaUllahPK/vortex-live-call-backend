import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

// DISCOVERY TRACKING
const DISCOVERY_ITEMS = {
  distributor_inquiry: {
    priority_1: [
      { id: "accept_accounts", label: "Accept new accounts", key: "accept_accounts" },
      { id: "moq", label: "MOQ", key: "moq" },
      { id: "documents", label: "Required documents", key: "documents" },
      { id: "approval_process", label: "Approval process", key: "approval_process" },
      { id: "approval_timeline", label: "Approval timeline", key: "approval_timeline" }
    ],
    priority_2: [
      { id: "payment_terms", label: "Payment terms", key: "payment_terms" },
      { id: "shipping_policy", label: "Shipping policy", key: "shipping_policy" },
      { id: "inventory", label: "Inventory availability", key: "inventory" },
      { id: "restrictions", label: "Brand restrictions", key: "restrictions" }
    ],
    priority_3: [
      { id: "opportunities", label: "Growth opportunities", key: "opportunities" },
      { id: "categories", label: "Additional brands/categories", key: "categories" }
    ]
  },
  quick_note: {
    priority_1: [
      { id: "accept_wholesale", label: "Accept wholesale partners", key: "accept_wholesale" },
      { id: "approval_process", label: "Approval process", key: "approval_process" },
      { id: "requirements", label: "Requirements", key: "requirements" },
      { id: "moq", label: "MOQ/volume expectations", key: "moq" }
    ],
    priority_2: [
      { id: "timeline", label: "Approval timeline", key: "timeline" },
      { id: "decision_maker", label: "Decision maker confirmed", key: "decision_maker" }
    ]
  },
  brand_registry: {
    priority_1: [
      { id: "aware_issue", label: "Aware of Amazon challenges", key: "aware_issue" },
      { id: "brand_registry", label: "Brand Registry status", key: "brand_registry" },
      { id: "unauthorized_sellers", label: "Unauthorized seller concern", key: "unauthorized_sellers" }
    ],
    priority_2: [
      { id: "decision_maker", label: "Decision maker identified", key: "decision_maker" },
      { id: "interest", label: "Interest level", key: "interest" }
    ]
  },
  retail_inquiry: {
    priority_1: [
      { id: "current_channels", label: "Current distribution channels", key: "current_channels" },
      { id: "wholesale_open", label: "Open to wholesale partners", key: "wholesale_open" },
      { id: "requirements", label: "Partner requirements", key: "requirements" }
    ],
    priority_2: [
      { id: "ideal_partner", label: "Ideal partner profile", key: "ideal_partner" },
      { id: "approval_process", label: "Approval process", key: "approval_process" }
    ]
  }
};

// CONVERSATION STAGES
const STAGES = {
  introduction: "Introduction",
  qualification: "Qualification",
  discovery: "Discovery",
  documentation: "Documentation & Approval",
  closing: "Closing"
};

// VORTEX BUSINESS PROFILE
const VORTEX_PROFILE = `
=== VORTEX ORIGIN BRANDS LLC ===
Company: Vortex Origin Brands, Wyoming-based wholesale company
Founder: Sanaullah
Business: Wholesale Purchasing & Supplier Partnerships
Identity: WHOLESALE BUYER (not consultant, not agency, not service provider)
Positioning: Professional retail & distribution business

When asked about Vortex:
"We're Vortex Origin Brands, a Wyoming-based wholesale company. We work with established 
suppliers across consumer product categories and we're currently expanding our supplier network."

MISSION: 
Be a professional, professional wholesale buyer. Sound like a real business, not a pitch.
`;

// CALL TYPE INSTRUCTIONS
const CALL_INSTRUCTIONS = {
  distributor_inquiry: `
YOU'RE THE BUYER. They're the supplier/distributor.
GOAL: Open a wholesale account. Learn their requirements and process.
STAGE PROGRESSION: Introduction → Qualification → Discovery → Documentation & Approval
  `,
  quick_note: `
BRAND YOU WANT TO BUY FROM.
GOAL: Learn if they're open to wholesale partnerships. What's their process?
STAGE PROGRESSION: Introduction → Qualification → Discovery → Closing
  `,
  brand_registry: `
BRAND WITH UNPROTECTED AMAZON PRESENCE.
GOAL: Help them see Amazon opportunity. Position yourself as wholesale buyer + Amazon manager.
STAGE PROGRESSION: Introduction → Awareness → Interest → Discovery → Closing
  `,
  retail_inquiry: `
BRAND THAT DOESN'T WANT AMAZON.
GOAL: Position as retail purchasing partner. Learn distribution needs.
**NEVER MENTION AMAZON unless they bring it up.**
STAGE PROGRESSION: Introduction → Qualification → Discovery → Closing
  `
};

// DETERMINE CURRENT STAGE
function determineStage(conversationHistory, callType) {
  if (!conversationHistory || conversationHistory.length === 0) return STAGES.introduction;
  
  const messages = conversationHistory.map(h => h.text.toLowerCase()).join(" ");
  
  // Introduction: First exchange
  if (conversationHistory.length <= 2) return STAGES.introduction;
  
  // Qualification: Learning about them
  if (messages.includes("what do you") || messages.includes("how do you") || 
      messages.includes("your company") || messages.includes("your business")) {
    return STAGES.qualification;
  }
  
  // Discovery: Deep details
  if (messages.includes("moq") || messages.includes("certificate") || 
      messages.includes("process") || messages.includes("approval")) {
    return STAGES.discovery;
  }
  
  // Documentation: Specific requirements
  if (messages.includes("document") || messages.includes("requirement") || 
      messages.includes("need from")) {
    return STAGES.documentation;
  }
  
  // Closing: Next steps
  if (messages.includes("next") || messages.includes("when") || 
      messages.includes("timeline") || messages.includes("send")) {
    return STAGES.closing;
  }
  
  return STAGES.discovery;
}

// AUTO-DETECT DISCOVERED ITEMS
function autoDetectDiscovery(transcript, itemsList) {
  const discovered = [];
  const text = transcript.toLowerCase();
  
  itemsList.forEach(item => {
    // Check if this discovery was mentioned
    const keywords = getKeywords(item.key);
    if (keywords.some(kw => text.includes(kw))) {
      discovered.push(item.id);
    }
  });
  
  return discovered;
}

function getKeywords(itemKey) {
  const keywordMap = {
    accept_accounts: ["accept", "yes we", "we do", "new account"],
    moq: ["moq", "minimum order", "order quantity", "$", "units"],
    documents: ["document", "certificate", "reseller", "require", "need"],
    approval_process: ["process", "application", "approval", "steps"],
    approval_timeline: ["how long", "days", "weeks", "timeline", "time"],
    payment_terms: ["payment", "net 30", "net 60", "terms", "invoice"],
    shipping_policy: ["shipping", "ship", "freight", "delivery"],
    inventory: ["inventory", "stock", "available", "in stock"],
    restrictions: ["restrict", "amazon", "exclusive", "territory", "cannot"],
    opportunities: ["opportunity", "growth", "scale", "volume"],
    categories: ["category", "brand", "line", "products we carry"],
    accept_wholesale: ["wholesale", "yes", "interested", "open to"],
    aware_issue: ["know", "aware", "problem", "issue", "challenge"],
    brand_registry: ["brand registry", "protected", "registration"],
    unauthorized_sellers: ["seller", "third party", "unauthorized", "multiple"],
    current_channels: ["sell", "channel", "where", "website", "retail"],
    wholesale_open: ["wholesale", "partner", "interested", "open to"],
    ideal_partner: ["ideal", "look for", "want", "important"],
    interest: ["interested", "could work", "sounds good", "maybe"],
    decision_maker: ["decision", "approve", "manager", "owner", "boss"]
  };
  
  return keywordMap[itemKey] || [];
}

// SCORE ACCOUNT OPPORTUNITY
function scoreAccount(discovered, callType) {
  const items = DISCOVERY_ITEMS[callType];
  const allItems = [...items.priority_1, ...items.priority_2, ...items.priority_3];
  const p1Count = items.priority_1.filter(i => discovered.includes(i.id)).length;
  const p1Total = items.priority_1.length;
  
  // Strong opportunity: All or most priority 1 items discovered
  if (p1Count >= p1Total - 1) return "🟢";
  
  // Needs more discovery: Some priority 1 items
  if (p1Count >= p1Total / 2) return "🟡";
  
  // Poor fit or early stage
  if (p1Count < p1Total / 2) return "🟡";
  
  return "🟡";
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Vortex Live Call Backend" });
});

app.post("/api/analyze-live", async (req, res) => {
  try {
    const { transcript, conversationHistory, brief, callType } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: "Transcript required" });
    }

    // Build conversation context
    let context = "";
    if (conversationHistory && conversationHistory.length > 0) {
      context = "Conversation so far:\n";
      conversationHistory.forEach(item => {
        context += `${item.speaker === 'contact' ? 'Contact' : 'Sanaullah'}: ${item.text}\n`;
      });
      context += "\n";
    }

    // Get call type instructions
    const instruction = CALL_INSTRUCTIONS[callType] || CALL_INSTRUCTIONS.distributor_inquiry;
    const items = DISCOVERY_ITEMS[callType] || DISCOVERY_ITEMS.distributor_inquiry;
    const allItems = [...items.priority_1, ...items.priority_2, ...items.priority_3];
    
    // Determine current stage
    const currentStage = determineStage(conversationHistory, callType);
    
    // Auto-detect what's been discovered
    const allDiscoveredInHistory = conversationHistory
      .filter(h => h.speaker === 'contact')
      .flatMap(h => autoDetectDiscovery(h.text, allItems));
    const discovered = [...new Set(allDiscoveredInHistory)];
    
    // Score account
    const score = scoreAccount(discovered, callType);
    
    // Get missing items
    const discovered_ids = new Set(discovered);
    const missing_p1 = items.priority_1.filter(i => !discovered_ids.has(i.id));
    
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 250,
      messages: [
        {
          role: "user",
          content: `${VORTEX_PROFILE}

${instruction}

${context}Contact just said: "${transcript}"

You are a LIVE CALL COPILOT. Provide real-time guidance.

OUTPUT EXACTLY in this format:

SAY NOW:
[2-5 conversational sentences. Sanaullah should say this immediately. Sound natural. Answer their question first, then naturally continue discovery.]

WATCH FOR:
- [Thing to listen for]
- [Thing to listen for]

RED FLAGS:
[List if relevant, otherwise write: None]

Do NOT explain your reasoning. Do NOT provide coaching. Just tell Sanaullah what to say next.`
        }
      ]
    });

    const guidance = message.content[0].type === "text" ? message.content[0].text : "";

    res.json({
      guidance,
      currentStage,
      discovered,
      missing: missing_p1.map(i => i.label),
      score,
      accountScore: score
    });
  } catch (error) {
    console.error("Claude API error:", error);
    res
      .status(500)
      .json({ error: "Failed to generate response", details: error.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ Vortex Live Call Backend (Copilot Mode) running on port ${PORT}`);
});
