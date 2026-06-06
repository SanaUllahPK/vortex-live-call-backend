import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

const VORTEX_BUSINESS_PROFILE = `
=== VORTEX ORIGIN BRANDS LLC ===

Company: Vortex Origin Brands, Wyoming-based wholesale company
When introducing yourself:
"We're Vortex Origin Brands, a Wyoming-based wholesale company. We work with 
established suppliers across consumer product categories and we're currently 
expanding our supplier network."

Keep it SHORT. CLEAN. BELIEVABLE.
`;

// DISCOVERY STAGES & REQUIREMENTS
const DISCOVERY_STAGES = {
  distributor_inquiry: {
    stages: [
      {
        name: "Introduction",
        items: ["decision_maker"]
      },
      {
        name: "Capability",
        items: ["accounts_open", "moq"]
      },
      {
        name: "Requirements",
        items: ["reseller_cert", "documents"]
      },
      {
        name: "Process",
        items: ["approval_process", "approval_timeline"]
      },
      {
        name: "Catalog",
        items: ["brands_carried"]
      },
      {
        name: "Verification",
        items: ["payment_terms", "shipping_policy"]
      }
    ],
    all_items: [
      { id: "decision_maker", label: "Decision maker", stage: "Introduction" },
      { id: "accounts_open", label: "Do they accept new accounts?", stage: "Capability" },
      { id: "moq", label: "MOQ", stage: "Capability" },
      { id: "reseller_cert", label: "Reseller certificate required?", stage: "Requirements" },
      { id: "documents", label: "Documents required", stage: "Requirements" },
      { id: "approval_process", label: "Approval process", stage: "Process" },
      { id: "approval_timeline", label: "Approval timeline", stage: "Process" },
      { id: "brands_carried", label: "Brands/categories", stage: "Catalog" },
      { id: "payment_terms", label: "Payment terms", stage: "Verification" },
      { id: "shipping_policy", label: "Shipping policy", stage: "Verification" }
    ]
  }
};

// OPENING SCRIPTS (SHORT & CLEAN)
const OPENING_SCRIPTS = {
  distributor_inquiry: `
"Hey [Name], thanks for picking up. I'm Sanaullah with Vortex Origin Brands, 
a Wyoming-based wholesale company. We work with established suppliers across 
consumer product categories and we're currently expanding our supplier network. 
Before I take up too much of your time, what does your typical process look 
like for setting up a new wholesale account?"
  `,
  
  quick_note: `
"Hey [Name], thanks for picking up. I'm Sanaullah with Vortex Origin Brands. 
We're a Wyoming-based wholesale company expanding our supplier network. Do you 
handle wholesale accounts, or is there someone on your team I should talk to?"
  `,
  
  brand_registry: `
"Hey [Name], thanks for taking the call. I'm Sanaullah with Vortex Origin Brands. 
I came across your products on Amazon and noticed you've got multiple third-party 
sellers offering them. I run a wholesale operation and we help brands protect and 
properly represent themselves on Amazon. Do you have a few minutes?"
  `,
  
  retail_inquiry: `
"Hey [Name], thanks for your time. I'm Sanaullah with Vortex Origin Brands, 
a Wyoming-based retail and distribution business. We work with a select group 
of suppliers and focus on consistent, reliable ordering and proper brand 
representation. I came across your company and was impressed. Do you work 
with wholesale partners?"
  `
};

// CALL TYPE GUIDES - MINIMAL, FOCUSED
const CALL_TYPE_GUIDES = {
  distributor_inquiry: `
=== DISTRIBUTOR INQUIRY ===

YOU'RE THE BUYER. They're the supplier.

GOAL: Learn if you can open an account. What do they require? What's the timeline?

DISCOVERY STAGES (in order):
1. Introduction - Confirm decision maker
2. Capability - Do they accept new accounts? What's MOQ?
3. Requirements - What docs/cert do they need?
4. Process - What's approval process? Timeline?
5. Catalog - What brands/categories do they carry?
6. Verification - Payment terms? Shipping?

TONE: Professional buyer. You have buying power. You're evaluating fit.

INTRODUCTION:
"We're Vortex Origin Brands, a Wyoming-based wholesale company. We work with 
established suppliers across consumer product categories and we're currently 
expanding our supplier network."
  `,
  
  quick_note: `
=== QUICK NOTE / WHOLESALE ACCOUNT INQUIRY ===

TARGET: Brands you want to buy from at wholesale.

GOAL: Learn if they're open to wholesale partnerships. What's their process?

INTRODUCTION:
"We're Vortex Origin Brands, a Wyoming-based wholesale company expanding our 
supplier network. Do you handle wholesale accounts, or is there someone on your 
team I should talk to?"

KEY DISCOVERY:
- Wholesale interest?
- Decision maker
- Approval process
- Requirements
- Volume expectations
  `,
  
  brand_registry: `
=== BRAND REGISTRY / AMAZON PROTECTION ===

TARGET: Brands with unprotected Amazon presence.

GOAL: Help them see Amazon opportunity. Understand current situation.

INTRODUCTION:
"I'm Sanaullah with Vortex Origin Brands. I came across your products on Amazon 
and noticed you've got multiple third-party sellers offering them. I run a 
wholesale operation and we help brands protect and properly represent themselves 
on Amazon. Do you have a few minutes?"

KEY DISCOVERY:
- Brand Registry status?
- Current Amazon challenges?
- Who manages Amazon?
- Interest in protection?
  `,
  
  retail_inquiry: `
=== RETAIL INQUIRY (AMAZON-ALLERGIC) ===

TARGET: Brands that don't want Amazon.

**NEVER MENTION AMAZON unless they bring it up.**

GOAL: Position as retail purchasing partner.

INTRODUCTION:
"I'm Sanaullah with Vortex Origin Brands, a Wyoming-based retail and distribution 
business. We work with a select group of suppliers and focus on consistent, 
reliable ordering and proper brand representation. I came across your company 
and was impressed. Do you work with wholesale partners?"

KEY DISCOVERY:
- Current distribution?
- Wholesale open?
- Requirements?
  `
};

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Vortex Live Call Backend" });
});

app.post("/api/analyze-live", async (req, res) => {
  try {
    const { transcript, conversationHistory, brief, callType, checkedItems } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: "Transcript required" });
    }

    let context = "";
    if (conversationHistory && conversationHistory.length > 0) {
      context = "Conversation so far:\n";
      conversationHistory.forEach(item => {
        context += `${item.speaker === 'supplier' ? 'Contact' : 'Sanaullah'}: ${item.text}\n`;
      });
      context += "\n";
    }

    const callTypeGuide = CALL_TYPE_GUIDES[callType] || CALL_TYPE_GUIDES.distributor_inquiry;
    const stageConfig = DISCOVERY_STAGES[callType];

    // Determine current stage based on checked items
    let currentStageIndex = 0;
    if (stageConfig) {
      for (let i = 0; i < stageConfig.stages.length; i++) {
        const stageItems = stageConfig.stages[i].items;
        const allChecked = stageItems.every(item => checkedItems && checkedItems[item]);
        if (allChecked) {
          currentStageIndex = i + 1;
        } else {
          break;
        }
      }
    }

    const currentStage = stageConfig?.stages[currentStageIndex]?.name || "Discovery";

    // Calculate discovery score
    const totalItems = stageConfig?.all_items.length || 10;
    const checkedCount = Object.values(checkedItems || {}).filter(Boolean).length;
    const discoveryScore = Math.round((checkedCount / totalItems) * 10);

    // Get missing items for current stage
    let missingItems = [];
    if (stageConfig && currentStageIndex < stageConfig.stages.length) {
      missingItems = stageConfig.stages[currentStageIndex].items
        .map(itemId => stageConfig.all_items.find(item => item.id === itemId)?.label)
        .filter(Boolean);
    }

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      messages: [
        {
          role: "user",
          content: `${callTypeGuide}

${context}Contact just said: "${transcript}"

Generate ONLY the next question Sanaullah should ask. 
One sentence. Direct. No explanation.
Focus on the highest-value missing information for this stage.
Make it conversational and natural.`
        }
      ]
    });

    const nextQuestion =
      message.content[0].type === "text" ? message.content[0].text.trim() : "";

    res.json({
      nextQuestion,
      currentStage,
      discoveryScore,
      missingItems,
      checkedCount,
      totalItems
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
  console.log(`✅ Vortex Live Call Backend running on port ${PORT}`);
});
