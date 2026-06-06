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
Founder: Sanaullah
What We Do: Purchase inventory in bulk, work with suppliers across multiple categories
Identity: Wholesale buyer, NOT consultant or agency

When answering "tell me about your company":
"We're Vortex Origin Brands, a Wyoming-based wholesale company. We work with suppliers 
and brands across multiple product categories and we're currently expanding our supplier 
network. I came across your company and wanted to learn more about your wholesale program 
and see if there might be a fit."

Discovery comes FIRST. Pitching comes LATER.
`;

// DISTRIBUTOR-SPECIFIC DISCOVERY PRIORITIES
const DISCOVERY_PRIORITIES = {
  distributor_inquiry: {
    level_1_must_learn: [
      "Do they accept new wholesale accounts?",
      "What's their MOQ (Minimum Order Quantity)?",
      "Do they require a reseller certificate or business license?",
      "What's their application/approval process?",
      "How long does approval typically take?",
      "What brands/product categories do they carry?"
    ],
    level_2_good_to_learn: [
      "What's their shipping policy?",
      "What payment terms do they offer?",
      "Do they have MAP (Minimum Advertised Price) restrictions?",
      "Do they restrict sales on Amazon?",
      "Are there territory restrictions?",
      "What documentation do they require from new buyers?"
    ],
    level_3_later: [
      "Volume discounts available?",
      "Special promotional programs?",
      "Exclusive brand arrangements?",
      "Return/restocking policies?"
    ]
  }
};

// CALL TYPE GUIDES - UPDATED WITH BETTER STRUCTURE
const CALL_TYPE_GUIDES = {
  quick_note: `
=== QUICK NOTE / WHOLESALE ACCOUNT INQUIRY ===

Target: Brands you want to buy from at wholesale
Email type: "Wholesale Inquiry A & B"

YOUR ROLE: You're a buyer seeking to establish a wholesale purchasing relationship.

OPENING SCRIPT:
"Hey [Name], thanks for picking up. I'm Sanaullah with Vortex Origin Brands—we're a 
Wyoming-based wholesale company. We work with suppliers across multiple product categories 
and we're expanding our supplier network. Do you handle wholesale accounts, or is there 
someone on your team I should be talking to?"

KEY DISCOVERY AREAS:
- Do they work with wholesale partners?
- What's their approval process?
- What do they require from new wholesale accounts?
- Who makes partnership decisions?
- What's their MOQ/volume expectations?

TONE: Respectful buyer, not desperate. You're evaluating if they're a fit.
  `,

  brand_registry: `
=== BRAND REGISTRY / AMAZON PROTECTION ===

Target: Brands with unprotected Amazon presence
Email type: "For Brands Not Yet in Brand Registry"

YOUR ROLE: You're a wholesale buyer offering to manage their Amazon channel properly.

OPENING SCRIPT:
"Hey [Name], thanks for taking the call. I'm Sanaullah with Vortex Origin Brands. 
I came across your products on Amazon and noticed you've got multiple third-party sellers 
offering them—which is pretty common. I run a wholesale operation, and part of what we do 
is help brands protect and properly represent themselves on Amazon. Do you have a few minutes?"

KEY DISCOVERY AREAS:
- Do they have Brand Registry set up?
- Who manages their Amazon currently?
- Are they aware of unauthorized sellers?
- What's their biggest Amazon challenge?
- Do they want to protect their brand on Amazon?

TONE: Helpful expert who sees an opportunity they may have missed.
  `,

  retail_inquiry: `
=== RETAIL INQUIRY (AMAZON-ALLERGIC) ===

Target: Brands that don't want Amazon
Email type: "Non-Amazon (Safe Retail Angle)"

**CRITICAL: NEVER mention Amazon unless they bring it up.**

YOUR ROLE: You're a retail buyer/distributor seeking wholesale accounts.

OPENING SCRIPT:
"Hey [Name], thanks for your time. I'm Sanaullah with Vortex Origin Brands—we're a 
Wyoming-based retail and distribution business. We work with a select group of suppliers 
and focus on consistent, reliable ordering and proper brand representation. I came across 
your company and was impressed. Do you work with wholesale partners?"

KEY DISCOVERY AREAS:
- How do they currently distribute?
- What channels do they focus on?
- Do they work with retail/wholesale partners?
- What's their ideal retail partner?
- Who makes partnership decisions?

TONE: Legitimate retail buyer, respectful of their distribution strategy.
  `,

  distributor_inquiry: `
=== DISTRIBUTOR INQUIRY (YOU'RE THE BUYER) ===

Target: Distributors/suppliers you want to buy FROM
Email type: "Opening wholesale account with Distributor"

YOUR ROLE: You're a growing wholesale buyer seeking to open accounts with suppliers.

OPENING SCRIPT:
"Hey [Name], thanks for picking up. I'm Sanaullah with Vortex Origin Brands—we're a 
Wyoming-based wholesale company. We're currently expanding our supplier network across 
multiple product categories, and I came across your company. Before I take up too much 
of your time, what does your typical process look like for setting up a new wholesale account?"

DISCOVERY PRIORITY LEVEL 1 (MUST LEARN):
☐ Do they accept new wholesale accounts?
☐ What's their MOQ?
☐ Reseller certificate required?
☐ Application process?
☐ Approval timeline?
☐ What brands/categories do they carry?

DISCOVERY PRIORITY LEVEL 2 (GOOD TO LEARN):
☐ Shipping policy?
☐ Payment terms?
☐ MAP restrictions?
☐ Amazon restrictions?
☐ Territory restrictions?
☐ Documentation required?

DISCOVERY PRIORITY LEVEL 3 (LATER):
- Volume discounts
- Promotional programs
- Exclusives
- Return policies

TONE: Professional buyer. You have buying power. You're evaluating if they're a good fit.

NEXT OBJECTIVE AFTER OPENING:
Learn their approval process and requirements.
  `
};

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Vortex Live Call Backend" });
});

app.post("/api/analyze-live", async (req, res) => {
  try {
    const { transcript, missionType, conversationHistory, brief, callType } = req.body;

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

    let briefContext = "";
    if (brief && brief.trim()) {
      briefContext = `CALL BRIEF:\n${brief}\n\n`;
    }

    const callTypeGuide = CALL_TYPE_GUIDES[callType] || CALL_TYPE_GUIDES.quick_note;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `${VORTEX_BUSINESS_PROFILE}

${callTypeGuide}

${briefContext}${context}Contact just said: "${transcript}"

Generate coaching in this exact format:

NEXT OBJECTIVE:
[What's the goal right now? What do you need to learn next?]

WHY THIS MATTERS:
[Why is learning this important?]

SUGGESTED QUESTION:
[The actual question Sanaullah should ask]

COACHING NOTES:
[Any tone/approach tips]

Keep suggested question to 1-2 sentences. Be conversational, not robotic.`
        }
      ]
    });

    const guidance =
      message.content[0].type === "text" ? message.content[0].text : "";

    res.json({ guidance });
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
