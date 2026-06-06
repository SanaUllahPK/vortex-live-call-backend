import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

const VORTEX_PROFILE = `
=== VORTEX ORIGIN BRANDS LLC ===
Company: Vortex Origin Brands, Wyoming-based wholesale company
Founder: Sanaullah
Business: Wholesale Buyer & Supplier Partnerships
Position: Professional retail & distribution business

When asked about Vortex:
"We're Vortex Origin Brands, a Wyoming-based wholesale company. We work with 
established suppliers across multiple product categories and we're currently 
expanding our supplier network."

CRITICAL: Always position Vortex as a WHOLESALE BUYER.
Never as: consultant, agency, service provider, or Amazon specialist.
`;

const CALL_INSTRUCTIONS = {
  distributor_inquiry: `
YOU ARE THE BUYER. They are the supplier/distributor.
GOAL: Open a wholesale account with them.
DISCOVERY: Learn their MOQ, required documents, approval process, timeline, payment terms.
TONE: Professional buyer with real purchasing power.
  `,
  
  quick_note: `
TARGET: Brand you want to buy from.
GOAL: Learn if they're open to wholesale partnerships.
DISCOVERY: Their approval process, requirements, MOQ, decision maker.
TONE: Professional buyer evaluating partnership fit.
  `,
  
  brand_registry: `
TARGET: Brand with unprotected Amazon presence.
GOAL: Position as wholesale buyer + Amazon manager.
DISCOVERY: Current Amazon situation, Brand Registry status, interest level.
TONE: Helpful professional who sees an opportunity.
  `,
  
  retail_inquiry: `
TARGET: Brand that doesn't want Amazon.
GOAL: Position as retail purchasing partner ONLY.
**CRITICAL: NEVER mention Amazon unless they bring it up first.**
DISCOVERY: Current distribution, wholesale openness, requirements.
TONE: Legitimate retail buyer.
  `
};

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Vortex Live Call Copilot v1" });
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

    const instruction = CALL_INSTRUCTIONS[callType] || CALL_INSTRUCTIONS.distributor_inquiry;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `${VORTEX_PROFILE}

${instruction}

${context}Contact just said: "${transcript}"

You are Sanaullah's live call copilot.
Your ONLY job: Tell him what to say next.

RULES:
1. Answer their question first (never dodge)
2. Answer clearly and professionally
3. Then continue discovery naturally (if appropriate)
4. Sound like a real person, not a script
5. Sound like a professional wholesale buyer
6. Use whatever length is necessary (1 sentence or 5 sentences)

OUTPUT ONLY:

SAY NOW:
[Exact words Sanaullah should say. Nothing else.]

Do not explain. Do not coach. Just tell him what to say.`
        }
      ]
    });

    const guidance = message.content[0].type === "text" ? message.content[0].text : "";

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
  console.log(`✅ Vortex Live Call Copilot v1 running on port ${PORT}`);
});
