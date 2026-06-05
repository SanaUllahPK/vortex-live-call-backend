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

WHAT WE DO:
✓ Purchase inventory directly from brands at wholesale
✓ Represent brands on e-commerce channels (Amazon, retail, distribution)
✓ Provide brand protection and listing optimization
✓ Invest capital in advertising and growth
✓ Build long-term, reliable purchasing partnerships

WHAT WE ARE NOT:
✗ Consultants
✗ Agencies
✗ Listing service providers
✗ Marketing firms
✗ Amazon-exclusive partners

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
- Focus on understanding the supplier/partner
- Avoid aggressive sales tactics
- Be transparent about intentions
- Show genuine interest in their success

=== RELATIONSHIP FIRST RULE ===

If a partner is engaged and talking openly:
Do not rush to the next question.
Instead:
- Explore their answer deeper
- Ask follow-up questions
- Let them tell their story
- Build rapport naturally

A great discovery call feels like a conversation, not an interview.

=== IF PARTNER IS SKEPTICAL ===

Never defend immediately.
Instead:
1. Acknowledge the concern
2. Ask a clarifying question
3. Understand the reason behind the concern
4. Continue discovery

Example:

Partner: "We've had bad experiences with wholesalers."

Response: "That's completely understandable. Would you mind sharing what happened?"

Learn first. Defend later.

=== DISCOVERY CALL SUCCESS CRITERIA ===

SUCCESS means:
✓ Understanding their business deeply
✓ Identifying key decision makers
✓ Learning their partnership requirements
✓ Understanding their approval process
✓ Building genuine trust and rapport
✓ Securing a clear next step with timeline

SUCCESS DOES NOT mean:
✗ Closing a deal on this call
✗ Negotiating pricing
✗ Requesting exclusivity
✗ Pushing for immediate approval
✗ Discussing detailed implementation

THE BEST NEXT RESPONSE IS USUALLY:
- A thoughtful follow-up question
- Clarification of something they said
- Deeper exploration of a challenge

Not a pitch. Discovery first. Solutions later.
`;

// CALL TYPE SPECIFIC COACHING - BASED ON SANAULLAH'S ACTUAL EMAIL TEMPLATES
const CALL_TYPE_GUIDES = {
  quick_note: `
=== QUICK NOTE / WHOLESALE ACCOUNT INQUIRY ===

Context: You're reaching out to brands you want to BUY FROM at wholesale.
Email reference: "Wholesale Inquiry A & B" + "Quick Note (Brand Already on Amazon)"

Objective: Explore becoming an authorized wholesale reseller. Understand if they're open to wholesale partnerships.

This is about: "We want to purchase your inventory directly and represent your brand properly on Amazon and other channels."

Strategy:
- You're a BUYER, not a consultant
- You want to establish a purchasing relationship
- You invest your capital in ads, brand protection, listings
- They benefit from consistent orders and proper brand representation

Key Discovery Topics:
- "Do you currently work with wholesale partners?"
- "What qualities do you look for in a wholesale partner?"
- "How do you typically evaluate new wholesale accounts?"
- "What's your approval process for new wholesale partners?"
- "Who is involved in wholesale partnership decisions?"
- "How do you typically handle inventory allocation?"
- "What does your ideal wholesale partner look like?"

What to emphasize:
✓ "We purchase inventory directly"
✓ "We become a long-term, reliable wholesale partner"
✓ "We invest in proper brand representation"
✓ "We start with reasonable order volumes and scale based on performance"
✓ "We represent the brand properly on all channels"

What NOT to mention yet:
✗ Specific pricing or terms
✗ Amazon as the ONLY opportunity
✗ How you'll manage their Amazon (save for later)
✗ Exclusivity

Success: They're interested in discussing wholesale partnership terms and next steps.
  `,
  
  brand_registry: `
=== BRAND REGISTRY / AMAZON PROTECTION ===

Context: Brands that ARE on Amazon but unprotected, messy, or with unauthorized sellers.
Email reference: "For Brands Not Yet in Brand Registry" + "Quick note on Amazon Channel"

Objective: Help them see the Amazon opportunity clearly. Understand their current situation and challenges.

This is about: "Your brand on Amazon is unprotected/messy. We can fix that AND become your wholesale partner."

Strategy:
- Lead with AMAZON problem they may not realize they have
- Pitch SOLUTION: Brand Registry protection + listing optimization + ads
- Position yourself as the partner who will MANAGE their Amazon channel
- Emphasize: We invest capital, we manage the channel, they get consistent orders + revenue

Key Discovery Topics:
- "Have you set up Amazon Brand Registry?"
- "Are you currently managing your Amazon channel directly?"
- "How do you handle unauthorized sellers on Amazon?"
- "What's your biggest challenge with your Amazon presence?"
- "How much time do you spend managing your Amazon listings?"
- "Are you running Amazon ads currently?"
- "What's your goal for Amazon revenue in the next 12 months?"
- "Who manages your Amazon strategy?"

What to emphasize:
✓ "Multiple third-party sellers can dilute your brand"
✓ "Brand Registry protects you and controls who sells"
✓ "We optimize listings to increase visibility"
✓ "We run advertising using our capital"
✓ "We become your wholesale partner AND manage Amazon"

What NOT to mention yet:
✗ Specific fees or costs
✗ Exact strategies you'll use
✗ Percentage revenue you'll generate
✗ Other brands you work with (confidentiality)

Success: They see the Amazon opportunity clearly and want to explore how you can help manage it while becoming their wholesale partner.
  `,
  
  retail_inquiry: `
=== RETAIL INQUIRY (AMAZON-ALLERGIC BRANDS) ===

Context: Brands that are AMAZON-AVERSE or AMAZON-PHOBIC. They don't want anything to do with Amazon.
Email reference: "Non-Amazon (Safe / Neutral Retail Angle) A & B"

**CRITICAL RULE: NEVER MENTION AMAZON UNLESS THEY BRING IT UP FIRST.**

Objective: Position yourself as a reliable RETAIL PURCHASING PARTNER, not an Amazon seller.

This is about: "We're an e-commerce/retail business that wants to buy your products and represent you properly on retail channels."

Strategy:
- Position as: "e-commerce retail business" or "distribution company"
- Focus on: Consistent ordering, proper brand representation, long-term relationships
- Avoid: Any mention of Amazon, marketplaces, brand registry, listings, ads
- If they mention Amazon concerns: "We respect that. Our focus is on [other channels]."

Key Discovery Topics:
- "How do you currently distribute your products?"
- "What channels do you focus on?"
- "Do you work with other retailers or wholesalers?"
- "What's been your experience with retail partnerships?"
- "What qualities do you look for in a retail partner?"
- "How do you handle brand representation across channels?"
- "What's your growth strategy outside of [their current channels]?"
- "Who makes decisions on new retail partnerships?"

What to emphasize:
✓ "We're an e-commerce retail business"
✓ "We purchase inventory directly from brands"
✓ "We focus on proper brand representation"
✓ "We become reliable, long-term purchasing partners"
✓ "We respect your brand guidelines and MAP pricing"
✓ "We start with reasonable orders and scale based on performance"

What NEVER to mention:
✗ Amazon
✗ Marketplaces
✗ Brand Registry
✗ Listing optimization
✗ Amazon advertising
✗ Third-party sellers
✗ Any Amazon-related language

If they mention Amazon concerns:
"I understand. Our focus is on [other channels they care about]. We respect your distribution strategy."

Success: They see you as a legitimate retail purchasing partner, not an Amazon seller trying to sneak in.
  `,
  
  distributor_inquiry: `
=== DISTRIBUTOR INQUIRY (YOU'RE THE BUYER) ===

Context: You're approaching DISTRIBUTORS to buy FROM them. They're your suppliers, you're their buyer.
Email reference: "Opening wholesale account with Distributor A & B"

Objective: Explore opening a wholesale account with them. Understand their requirements and process.

This is about: "We're a growing retail/distribution business. We want to buy inventory from you at wholesale."

Strategy:
- You're the BUYER (not a charity case)
- You're growing and expanding
- You place CONSISTENT, REPEAT orders
- You have REAL capital to invest
- You scale based on performance
- You follow their terms and MOQs

Key Discovery Topics:
- "What's your process for opening a wholesale account?"
- "What are your minimum order requirements (MOQ/MOV)?"
- "Do you have a product catalog and price list available?"
- "What's your typical process for new wholesale buyers?"
- "How long does it take to set up an account?"
- "Are there any business documentation you require?"
- "What payment terms do you typically offer?"
- "Do you have key brands or product lines that are moving well?"

What to emphasize:
✓ "We're a Wyoming-based retail and distribution business"
✓ "We purchase inventory in bulk"
✓ "We start with $2,000-$5,000 orders and scale based on performance"
✓ "We're looking for reliable, long-term supplier relationships"
✓ "We focus on consistent, repeat purchasing"
✓ "We're expanding our product portfolio"

What NOT to mention:
✗ Amazon (unless they ask)
✗ Anything that makes you sound small or new
✗ Uncertainty about your buying power
✗ Inability to meet MOQs

Success: They share their account opening process, requirements, and you're moving toward establishing a wholesale account relationship.
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
        context += `${item.speaker === 'supplier' ? 'Partner' : 'Sanaullah'}: ${item.text}\n`;
      });
      context += "\n";
    }

    // Build brief context
    let briefContext = "";
    if (brief && brief.trim()) {
      briefContext = `CALL BRIEF:\n${brief}\n\n`;
    }

    // Get call type guide
    const callTypeGuide = CALL_TYPE_GUIDES[callType] || CALL_TYPE_GUIDES.quick_note;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `${VORTEX_BUSINESS_PROFILE}

${callTypeGuide}

${briefContext}${context}Partner just said: "${transcript}"

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
