import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

// VORTEX ORIGIN BRANDS - OFFICIAL DISCOVERY CALL COACHING BRIEF
const VORTEX_BUSINESS_PROFILE = `
=== VORTEX ORIGIN BRANDS LLC ===

COMPANY INFORMATION:
- Legal Name: Vortex Origin Brands LLC
- DBA: Northgate Mercantile
- State of Registration: Wyoming, USA
- Founder & Leader: Sanaullah
- Role: Founder & Supplier Relationship Lead
- Business Model: Wholesale Purchasing & Marketplace Operations
- Primary Identity: WHOLESALE BUYER (not consultant, not agency)
- Secondary Strength: Marketplace Operations & Growth Partnerships

WHAT WE ARE:
✓ Wholesale buyers focused on building long-term supplier partnerships
✓ We purchase inventory through wholesale relationships
✓ We leverage marketplace expertise to create growth opportunities
✓ We are relationship-focused and partnership-oriented

WHAT WE ARE NOT:
✗ Consultants
✗ Agencies
✗ Listing service providers
✗ Marketing firms

=== SANAULLAH'S COMMUNICATION STYLE ===

How Sanaullah should sound:
- Professional yet friendly
- Natural and conversational
- Easy to speak with
- Non-pushy and patient
- Relationship-first, always
- Curious and genuinely interested
- Confident but humble

How Sanaullah should act:
- Build trust BEFORE discussing business
- Ask thoughtful, genuine questions
- Listen carefully and deeply
- Focus on understanding the supplier
- Avoid aggressive sales tactics
- Be transparent about intentions
- Show genuine interest in their success

=== RELATIONSHIP FIRST RULE ===

If a supplier is engaged and talking openly:

Do not rush to the next question.

Instead:
- Explore their answer deeper
- Ask follow-up questions
- Let them tell their story
- Build rapport naturally

A great discovery call feels like a conversation, not an interview.

=== IF SUPPLIER IS SKEPTICAL ===

Never defend immediately.

Instead:

1. Acknowledge the concern
2. Ask a clarifying question
3. Understand the reason behind the concern
4. Continue discovery

Example:

Supplier: "We've had bad experiences with wholesalers."

Response: "That's completely understandable. Would you mind sharing what happened?"

Learn first.
Defend later.

=== DISCOVERY CALL SUCCESS CRITERIA ===

SUCCESS means:
✓ Understanding the supplier's business deeply
✓ Identifying key decision makers
✓ Learning their partnership requirements
✓ Understanding their approval process
✓ Building genuine trust and rapport
✓ Securing a clear next step with timeline
✓ Knowing whether partnership makes sense

SUCCESS DOES NOT mean:
✗ Closing a deal on this call
✗ Negotiating pricing
✗ Requesting exclusivity
✗ Pushing for immediate approval
✗ Discussing detailed strategy
✗ Pitching services

=== DO NOT DO THESE THINGS ===

Never:
✗ Pitch services too early
✗ Discuss implementation details
✗ Ask for exclusivity
✗ Negotiate pricing
✗ Push for approval

Until sufficient discovery is completed.

=== CALL COACHING APPROACH ===

Your role on discovery calls:
1. LISTEN first - ask open questions, don't pitch
2. UNDERSTAND - their challenges, goals, current state
3. QUALIFY - are they a fit for partnership?
4. BUILD TRUST - be authentic, be interested
5. NEXT STEP - secure a follow-up meeting with clear purpose

When coaching responses:
- Keep it natural and conversational
- Show genuine interest in what they said
- Ask follow-up questions that show you listened
- Never sound scripted or pushy
- Focus on understanding their business, not selling
- Build on trust, not urgency

THE BEST NEXT RESPONSE IS USUALLY:
- A thoughtful follow-up question
- Clarification of something they said
- Deeper exploration of a challenge

Not a pitch.

Discovery first.
Solutions later.
`;

// CALL TYPE SPECIFIC COACHING
const CALL_TYPE_GUIDES = {
  quick_note: `
=== QUICK NOTE OUTREACH ===

Objective: Very light, exploratory outreach. NOT a formal pitch.

This is a: "Hey, I noticed [X] about your company. Would love to chat sometime."

Strategy:
- Keep it SHORT and SIMPLE
- No commitments expected
- Goal: Get a follow-up meeting scheduled
- Build rapport, nothing else

Key Questions:
- "Do you have a quick 15 minutes?"
- "Would you be open to a quick conversation?"
- "I was curious about [specific thing about their business]"

Do NOT:
- Go deep into business details
- Ask complex discovery questions
- Discuss partnerships formally
- Take too much of their time

Success: They agree to a follow-up call or meeting.
  `,
  brand_registry: `
=== BRAND REGISTRY OUTREACH ===

Objective: Amazon-specific opportunity. They likely already sell on Amazon.

This is a: "I see you on Amazon. We can help you [specific Amazon benefit]."

Strategy:
- Lead with Amazon opportunity
- Focus on their current Amazon performance
- Understand their current challenges on Amazon
- Discuss marketplace-specific solutions

Key Questions:
- "How are you currently doing on Amazon?"
- "What's your biggest challenge on Amazon right now?"
- "Have you optimized your listings or A+ content?"
- "Are you running PPC campaigns?"

Do NOT:
- Assume they want your help
- Discuss offline sales
- Get into complex partnerships yet
- Pitch services

Success: They understand the Amazon opportunity and want a deeper conversation.
  `,
  retail_inquiry: `
=== RETAIL INQUIRY OUTREACH ===

Objective: Explore retail distribution opportunities.

This is a: "I help brands like yours expand retail distribution. Would love to explore if there's a fit."

Strategy:
- Understand their current retail presence
- Learn about their retail challenges
- Discuss distribution goals
- Understand wholesale requirements

Key Questions:
- "How many retail locations are you in currently?"
- "What's been your strategy for retail expansion?"
- "What challenges are you facing in retail distribution?"
- "What does your ideal retail partner look like?"
- "Who handles your retail partnerships?"

Do NOT:
- Promise specific retail placements
- Negotiate terms
- Commit to timelines
- Discuss wholesale pricing

Success: They're interested in exploring retail expansion opportunities with you.
  `,
  distributor_inquiry: `
=== DISTRIBUTOR INQUIRY OUTREACH ===

Objective: Explore distributor network opportunities.

This is a: "I help brands connect with distributors in your space."

Strategy:
- Understand current distributor relationships
- Learn about distribution challenges
- Discuss growth through distribution
- Understand distributor requirements

Key Questions:
- "Are you currently working with distributors?"
- "How do you approach distributor partnerships?"
- "What challenges do you face with current distributors?"
- "What's important to you in a distributor partnership?"
- "Who makes distributor decisions at your company?"

Do NOT:
- Pitch specific distributors
- Negotiate distributor terms
- Discuss pricing models
- Make commitments

Success: They see value in exploring distributor partnerships further.
  `,
  wholesale_partnership: `
=== WHOLESALE PARTNERSHIP OUTREACH ===

Objective: Explore direct wholesale purchasing partnership with Vortex.

This is a: "We're a wholesale buyer. We'd like to purchase your inventory and grow your brand."

Strategy:
- Understand their current business
- Learn about their wholesale experience
- Discuss partnership model (we buy, we manage)
- Understand their requirements for new wholesale partners

Key Questions:
- "Tell me about your business. How long have you been in operation?"
- "How do you currently distribute your products?"
- "Do you work with wholesale partners currently?"
- "What does your ideal wholesale partner look like?"
- "What's most important when evaluating new partnerships?"
- "How do you typically evaluate new wholesale accounts?"
- "Who else is involved in partnership decisions?"

Do NOT:
- Pitch what you do yet
- Discuss pricing or margins
- Push for exclusivity
- Negotiate terms

Success: They understand Vortex is a wholesale buyer and want to learn more about partnership.
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

    // Build context from conversation history
    let context = "";
    if (conversationHistory && conversationHistory.length > 0) {
      context = "Conversation so far:\n";
      conversationHistory.forEach(item => {
        context += `${item.speaker === 'supplier' ? 'Supplier' : 'Sanaullah'}: ${item.text}\n`;
      });
      context += "\n";
    }

    // Build brief context
    let briefContext = "";
    if (brief && brief.trim()) {
      briefContext = `DISCOVERY BRIEF FOR THIS CALL:\n${brief}\n\n`;
    }

    // Get call type guide
    const callTypeGuide = CALL_TYPE_GUIDES[callType] || CALL_TYPE_GUIDES.wholesale_partnership;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `${VORTEX_BUSINESS_PROFILE}

${callTypeGuide}

${briefContext}${context}Supplier just said: "${transcript}"

Coach Sanaullah on what to say next (1-2 sentences max).
Keep it natural, conversational, and relationship-focused.
Show genuine interest in understanding their business.

The best response is usually:
- A thoughtful follow-up question
- Clarification of something they said
- Deeper exploration of a challenge

Not a pitch.

Do NOT pitch services, push for approval, or negotiate.
Remember: Discovery first. Solutions later.`
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
