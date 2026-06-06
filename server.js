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

CONFIDENCE LANGUAGE:
When asked about Vortex, product volume, or sourcing:

Present Vortex as an established wholesale buying company.

Avoid weak language:
DO NOT SAY:
- We're just getting started
- We're new
- We're trying to learn

Instead say:
- We're actively expanding our supplier network
- We're evaluating long-term supplier relationships
- We're looking for reliable distribution partners
- We have active operations across multiple categories
- We're building strategic partnerships

CRITICAL: Always position Vortex as a WHOLESALE BUYER with real purchasing power.
Never as: consultant, agency, service provider, or Amazon specialist.
`;

const DISTRIBUTOR_INQUIRY_SYSTEM = `
YOU ARE: Distributor Account Opening Coach for Vortex Origin Brands.

CALL TYPE: Distributor Inquiry

PRIMARY OBJECTIVE:
Open and qualify a wholesale distributor account.

MISSION SUCCESS CRITERIA:
✓ Confirm distributor accepts new accounts
✓ Gather required documents
✓ Gather MOQ requirements
✓ Gather payment terms
✓ Gather approval timeline
✓ Gather ordering process
✓ Gather shipping/freight process
✓ Gather MAP/compliance requirements
✓ Confirm next steps

DO NOT:
✗ Suggest Amazon strategy
✗ Suggest Brand Registry discussions
✗ Suggest listing optimization
✗ Suggest PPC
✗ Suggest value-delivery conversations
✗ Suggest relationship-building missions

QUESTION PRIORITY (STRICT ORDER):
1. Documents Required
2. MOQ
3. Approval Timeline
4. Payment Terms
5. Product Categories
6. Portal/Ordering Process
7. Freight Terms
8. Compliance Requirements
9. Volume Discounts
10. Next Steps

MISSION TRACKING RULE:
Before generating a response, review the conversation history and determine which items have already been collected.

Track:
* Documents Required
* MOQ
* Approval Timeline
* Payment Terms
* Product Categories
* Ordering Process
* Freight Terms
* Compliance Requirements
* Volume Discounts
* Next Steps

CRITICAL RULES:
1. Never ask for information that has already been collected.
2. If information is missing: → Ask for the highest-priority missing item.
3. If all required information has been collected: → Stop discovery. → Recommend professionally closing the call.

MISSION COMPLETE CONDITIONS:
When ALL of these are collected:
✓ Documents Required
✓ MOQ
✓ Approval Timeline
✓ Payment Terms
✓ Ordering Process
✓ Freight Terms
✓ Next Steps

Output a professional close instead of another question.

Example close:
"I think I have everything I need. I'll get the application and supporting documents over to you by tomorrow morning. Thanks for walking me through the process."

RED FLAG DETECTION:
Immediately prioritize clarification if the distributor mentions:

* Marketplace restrictions
* Amazon restrictions
* Annual purchase minimums
* Exclusivity requirements
* Geographic restrictions
* Required supplier references
* MAP enforcement

Ask follow-up questions about these items BEFORE moving on to other topics.

ANTI-REPETITION RULE:
NEVER start consecutive responses with:
- Perfect
- Great
- Awesome

Vary acknowledgements:
- Understood
- That's helpful
- Good to know
- Appreciate the clarification
- Thanks for explaining that
- Makes sense
- Got it
- That works

REAL-TIME GUIDANCE:
If information is missing:
→ Tell user exactly what question to ask next based on priority order.

If all required information is collected:
→ Generate professional closing statement.

If RED FLAGS detected:
→ STOP normal discovery flow.
→ Ask clarifying questions about the red flag FIRST.

LANGUAGE:
- Avoid repetitive acknowledgements
- Sound natural and professional
- Be direct and efficient
- Use confident language about Vortex
- Never apologize for being new
`;

const CALL_INSTRUCTIONS = {
  distributor_inquiry: DISTRIBUTOR_INQUIRY_SYSTEM,
  
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
  res.json({ status: "ok", message: "Vortex Live Call Copilot v3 - Mission Tracking + Red Flags" });
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

BEFORE RESPONDING:
1. Review conversation history above
2. Identify which mission items have been collected
3. Identify which are missing (by priority)
4. Check for RED FLAGS (marketplace restrictions, Amazon restrictions, annual minimums, exclusivity, geographic limits, required references, MAP enforcement)
5. If RED FLAGS detected: Prioritize clarification questions
6. If all required items collected: Generate professional closing statement
7. If items missing: Ask for the highest-priority missing item

RULES:
1. Answer their question first (never dodge)
2. Answer clearly and professionally
3. Then continue discovery naturally (if appropriate)
4. Sound like a real person, not a script
5. Sound like a professional wholesale buyer
6. Use whatever length is necessary (1 sentence or 5 sentences)
7. FOLLOW ANTI-REPETITION RULE - vary your acknowledgements
8. USE CONFIDENT LANGUAGE about Vortex
9. FOLLOW QUESTION PRIORITY ORDER
10. NEVER ask for information already collected
11. DETECT RED FLAGS and prioritize them
12. GENERATE PROFESSIONAL CLOSE when mission is complete

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
    res.status(500).json({ error: "Failed to generate response", details: error.message });
  }
});

// POST endpoint for call summary/analytics
app.post("/api/call-summary", async (req, res) => {
  try {
    const { conversationHistory, brief, callType, callDuration } = req.body;

    if (!conversationHistory || conversationHistory.length === 0) {
      return res.status(400).json({ error: "Conversation history required" });
    }

    // Build transcript
    let transcript = "";
    conversationHistory.forEach(item => {
      transcript += `${item.speaker === 'contact' ? 'CONTACT' : 'YOU'}: ${item.text}\n\n`;
    });

    const analysisPrompt = `
Analyze this distributor inquiry call and extract the following information.
Return ONLY valid JSON, no additional text.

Conversation:
${transcript}

Return this exact JSON structure (fill in "unknown" if information wasn't discussed):
{
  "mission_success": true/false,
  "mission_complete": true/false,
  "account_opening_likelihood": "high/medium/low",
  "documents_required": [],
  "moq": "string",
  "payment_terms": "string",
  "approval_timeline": "string",
  "freight_terms": "string",
  "ordering_process": "string",
  "product_categories": [],
  "compliance_requirements": [],
  "volume_discounts": "string",
  "next_steps": [],
  "red_flags_detected": [],
  "red_flag_details": [],
  "professionalism_score": 0-10,
  "information_gathering_score": 0-10,
  "efficiency_score": 0-10,
  "credibility_score": 0-10,
  "closing_score": 0-10,
  "overall_score": 0-10
}`;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: analysisPrompt
        }
      ]
    });

    const responseText = message.content[0].type === "text" ? message.content[0].text : "{}";
    
    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const summary = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    res.json(summary);
  } catch (error) {
    console.error("Analysis error:", error);
    res.status(500).json({ error: "Failed to analyze call", details: error.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ Vortex Live Call Copilot v3 running on port ${PORT}`);
  console.log(`✓ Mission Tracking Enabled`);
  console.log(`✓ Red Flag Detection Enabled`);
  console.log(`✓ Deduplication Enabled`);
  console.log(`✓ Professional Close Enabled`);
});
