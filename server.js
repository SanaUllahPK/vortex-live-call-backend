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

const TRUTH_RULE = `
TRUTH RULE (FOUNDATION - OVERRIDES ALL OTHER RULES)

Never instruct Sanaullah to provide false information.

If asked:
* Do you sell on Amazon?
* Do you operate on marketplaces?
* Where do you sell?
* What channels do you use?
* Are you an Amazon seller?
* Do you have Amazon operations?

Answer truthfully. ALWAYS.

Trust preservation is more important than account approval.

If the answer creates a potential objection:

1. Acknowledge it.
2. Clarify the distributor's concern.
3. Determine whether the issue is:
   * MAP compliance
   * Pricing control
   * Unauthorized sellers
   * Channel conflict
   * Absolute prohibition

Never hide Amazon activity. Never deny Amazon activity if it exists.
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
✗ Provide false information (EVER)
✗ Deny Amazon activity if it exists

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

AMAZON RESTRICTION HANDLER (HIGH PRIORITY RED FLAG):
If a distributor asks: "Do you sell on Amazon?" "Are you an Amazon seller?" "Do you sell on marketplaces?"

Treat this as a HIGH PRIORITY RED FLAG.

TRUTH FIRST:
Answer truthfully about Amazon/marketplace operations.

RED FLAG: Amazon Restriction

Objective: Determine whether the restriction is:
1. Absolute Ban
2. MAP Compliance Concern
3. Pricing Concern
4. Channel Conflict Concern
5. Case-by-Case Review

Required Response Framework:
1. Answer honestly first. (DO NOT DENY OR INVENT)
2. Do not become defensive.
3. Do not immediately return to MOQ, payment terms, or ordering questions.
4. Clarify the real concern behind the policy.
5. Stay focused on the restriction until fully understood.

Recommended Response (TRUTHFUL):
"Yes, we do have Amazon operations. Can you help me understand your policy a little better? Is the concern marketplace pricing and channel conflict, or do you have a blanket restriction on Amazon sellers?"

Follow-Up Logic:
IF distributor explains concern: → Continue asking clarifying questions until policy is fully understood.
IF distributor has absolute prohibition: → Mark status = NOT FIT → Stop qualification process. → Exit professionally.
IF distributor allows Amazon sellers under conditions: → Capture exact requirements. → Continue qualification process.

CRITICAL PAUSE RULE:
Do NOT continue normal distributor discovery until the Amazon policy is fully clarified.

Pause ALL of:
* MOQ Questions
* Payment Terms Questions
* Freight Questions
* Approval Timeline Questions
* Ordering Process Questions

Resolve Amazon Restriction First.

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

LANGUAGE:
- Avoid repetitive acknowledgements
- Sound natural and professional
- Be direct and efficient
- Use confident language about Vortex
- Never apologize for being new
- Never invent information
- Be transparent about concerns
- Don't get defensive about Amazon operations
- Be honest and direct
`;

const RETAIL_INQUIRY_SYSTEM = `
YOU ARE: Retail Partnership Discovery Coach for Vortex Origin Brands.

CALL TYPE: Retail Inquiry

PRIMARY OBJECTIVE: 
Determine whether the company is open to wholesale partnerships.

MISSION SUCCESS CRITERIA:
✓ Identify decision maker
✓ Confirm wholesale program exists
✓ Understand approval process
✓ Understand account requirements
✓ Understand distribution restrictions
✓ Understand marketplace policy
✓ Determine partnership fit
✓ Secure next step

DISCOVERY PRIORITY (STRICT ORDER):
1. Are they open to wholesale accounts?
2. Who handles wholesale partnerships?
3. What is the approval process?
4. What documents are required?
5. Any distribution restrictions?
6. Any marketplace restrictions?
7. Any MAP policy?
8. Next step

DO NOT:
✗ Ask MOQ too early
✗ Ask payment terms too early
✗ Ask freight questions too early
✗ Ask volume discount questions too early
✗ Sound transactional
✗ Provide false information (EVER)
✗ Deny Amazon activity if it exists

CONVERSATION STYLE:
Retail Inquiry = Discovery First
You are learning:
* How they distribute
* Whether they want new partners
* Who makes decisions
* Whether Vortex is a fit

ANTI-INTERROGATION RULE:
Never ask more than one major qualification question at a time.

Make it conversational. Natural flow. One discovery point per response.

TRUTH RULE (CRITICAL):
If asked about Amazon/marketplace operations:
Answer truthfully. Never deny or invent.

RED FLAG HANDLING:
If they mention:
* No Amazon sellers
* Exclusivity
* Territory restrictions
* MAP enforcement
* Existing distributor conflicts

Pause normal discovery.
Answer truthfully about your operations.
Clarify the restriction completely before continuing.

ANTI-REPETITION RULE:
NEVER start consecutive responses with:
- Perfect
- Great
- Awesome

Vary acknowledgements:
- Understood
- That makes sense
- Appreciate that
- Good to know
- Thanks for explaining
- Got it
- That's helpful

LANGUAGE:
- Sound like a partnership-minded buyer
- Be curious, not interrogative
- Ask open-ended questions
- Listen more than you talk
- Don't push for details too early
- Be conversational and natural
- Be honest and direct
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
  retail_inquiry: RETAIL_INQUIRY_SYSTEM
};

// LIVE INTELLIGENCE TRACKING SYSTEM
const analyzeCallState = async (conversationHistory, callType) => {
  if (!conversationHistory || conversationHistory.length === 0) {
    return {
      collected: {},
      missing: [
        'Documents Required',
        'MOQ',
        'Approval Timeline',
        'Payment Terms',
        'Product Categories',
        'Ordering Process',
        'Freight Terms',
        'Compliance Requirements',
        'Volume Discounts',
        'Next Steps'
      ],
      redFlags: [],
      highestPriorityMissing: 'Documents Required',
      completionPercentage: 0
    };
  }

  // Build transcript for analysis
  let transcript = "";
  conversationHistory.forEach(item => {
    transcript += `${item.speaker === 'contact' ? 'CONTACT' : 'SANAULLAH'}: ${item.text}\n`;
  });

  // Use Claude to analyze state
  const analysisPrompt = `
Analyze this call conversation and identify:

1. What information has been COLLECTED (from the contact):
   - Documents Required
   - MOQ
   - Approval Timeline
   - Payment Terms
   - Product Categories
   - Ordering Process
   - Freight Terms
   - Compliance Requirements
   - Volume Discounts
   - Next Steps

2. What information is MISSING

3. RED FLAGS detected:
   - Amazon restriction
   - Marketplace restriction
   - Geographic restriction
   - Exclusivity requirement
   - MAP enforcement concern
   - Distributor conflict
   - No new accounts
   - Large MOQ concern
   - Payment term concern

4. Highest priority MISSING item (based on priority order)

Conversation:
${transcript}

Return ONLY valid JSON:
{
  "collected": {
    "documents_required": "string or null",
    "moq": "string or null",
    "approval_timeline": "string or null",
    "payment_terms": "string or null",
    "product_categories": "string or null",
    "ordering_process": "string or null",
    "freight_terms": "string or null",
    "compliance_requirements": "string or null",
    "volume_discounts": "string or null",
    "next_steps": "string or null"
  },
  "missing": ["array of missing items"],
  "red_flags": ["array of red flags detected"],
  "red_flag_details": "string describing red flag context",
  "highest_priority_missing": "string",
  "mission_complete": true/false,
  "completion_percentage": 0-100,
  "should_pause_discovery": true/false,
  "pause_reason": "string or null"
}`;

  try {
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
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    
    return analysis;
  } catch (error) {
    console.error("State analysis error:", error);
    return { collected: {}, missing: [], redFlags: [], error: true };
  }
};

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Vortex Live Call Copilot v8 - Live Intelligence Tracking" });
});

app.post("/api/analyze-live", async (req, res) => {
  try {
    const { transcript, conversationHistory, brief, callType } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: "Transcript required" });
    }

    // STEP 1: Analyze call state (internal tracking)
    const callState = await analyzeCallState(conversationHistory, callType);

    // STEP 2: Build conversation context
    let context = "";
    if (conversationHistory && conversationHistory.length > 0) {
      context = "Conversation so far:\n";
      conversationHistory.forEach(item => {
        context += `${item.speaker === 'contact' ? 'Contact' : 'Sanaullah'}: ${item.text}\n`;
      });
      context += "\n";
    }

    // STEP 3: Build internal state summary (for Claude's context only, not for user)
    const internalState = `
INTERNAL STATE TRACKING (DO NOT SHOW TO USER):

COLLECTED INFORMATION:
${Object.entries(callState.collected || {})
  .filter(([_, v]) => v !== null)
  .map(([k, v]) => `✓ ${k}: ${v}`)
  .join('\n') || 'None yet'}

MISSING INFORMATION:
${(callState.missing || []).map(item => `- ${item}`).join('\n') || 'None'}

RED FLAGS DETECTED:
${(callState.redFlags || []).length > 0 ? callState.redFlags.map(flag => `⚠ ${flag}`).join('\n') : 'None'}
${callState.red_flag_details ? `\nContext: ${callState.red_flag_details}` : ''}

MISSION PROGRESS: ${callState.completion_percentage || 0}%

HIGHEST PRIORITY MISSING: ${callState.highest_priority_missing || 'N/A'}

DISCOVERY SHOULD PAUSE: ${callState.should_pause_discovery ? `YES - ${callState.pause_reason}` : 'NO'}

MISSION COMPLETE: ${callState.mission_complete ? 'YES - Time to close' : 'NO - Continue discovery'}

---`;

    const instruction = CALL_INSTRUCTIONS[callType] || CALL_INSTRUCTIONS.distributor_inquiry;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `${internalState}

${TRUTH_RULE}

${VORTEX_PROFILE}

${instruction}

${context}Contact just said: "${transcript}"

You are Sanaullah's live call copilot.
Your ONLY job: Tell him what to say next.

CURRENT SITUATION:
- Collected: ${Object.keys(callState.collected || {}).filter(k => callState.collected[k] !== null).length} items
- Missing: ${(callState.missing || []).length} items
- Red Flags: ${(callState.redFlags || []).length}
- Mission Progress: ${callState.completion_percentage || 0}%

GUIDANCE:
${callState.should_pause_discovery ? `PAUSE normal discovery. Focus on: ${callState.pause_reason}` : callState.mission_complete ? 'All information collected. Time to close professionally.' : `Next priority: Gather ${callState.highest_priority_missing}`}

RULES:
1. TRUTH RULE OVERRIDES ALL
2. Answer their question first
3. Follow call state guidance
4. Don't ask for already-collected info
5. Pause for red flags
6. Close when mission complete

OUTPUT ONLY:

SAY NOW:
[Exact words Sanaullah should say. Nothing else.]`
        }
      ]
    });

    const guidance = message.content[0].type === "text" ? message.content[0].text : "";

    res.json({ 
      guidance,
      _callState: callState // Internal tracking (for debugging only, not sent to frontend)
    });
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

    // Get final state
    const finalState = await analyzeCallState(conversationHistory, callType);

    // Build transcript
    let transcript = "";
    conversationHistory.forEach(item => {
      transcript += `${item.speaker === 'contact' ? 'CONTACT' : 'YOU'}: ${item.text}\n\n`;
    });

    const analysisPrompt = `
Analyze this ${callType} call and extract the following information.
Return ONLY valid JSON, no additional text.

Conversation:
${transcript}

${callType === 'retail_inquiry' ? `
For Retail Inquiry, return:
{
  "call_type": "retail_inquiry",
  "discovery_complete": true/false,
  "wholesale_opportunity": "yes/no/unclear",
  "decision_maker_identified": true/false,
  "decision_maker": "string",
  "approval_process_understood": true/false,
  "approval_timeline": "string",
  "documents_required": [],
  "distribution_restrictions": "string",
  "marketplace_policy": "string",
  "map_policy": "string",
  "amazon_question_asked": true/false,
  "amazon_answer_truthful": true/false,
  "red_flags": [],
  "partnership_fit": "good/fair/poor",
  "next_step": "string",
  "call_duration_seconds": ${callDuration},
  "conversational_quality": 0-10,
  "discovery_effectiveness": 0-10,
  "credibility_score": 0-10,
  "honesty_score": 0-10,
  "overall_score": 0-10
}
` : `
For Distributor Inquiry, return:
{
  "call_type": "distributor_inquiry",
  "mission_success": true/false,
  "mission_complete": ${finalState.mission_complete},
  "completion_percentage": ${finalState.completion_percentage || 0},
  "account_opening_likelihood": "high/medium/low",
  "documents_required": "${finalState.collected?.documents_required || 'unknown'}",
  "moq": "${finalState.collected?.moq || 'unknown'}",
  "payment_terms": "${finalState.collected?.payment_terms || 'unknown'}",
  "approval_timeline": "${finalState.collected?.approval_timeline || 'unknown'}",
  "freight_terms": "${finalState.collected?.freight_terms || 'unknown'}",
  "ordering_process": "${finalState.collected?.ordering_process || 'unknown'}",
  "product_categories": "${finalState.collected?.product_categories || 'unknown'}",
  "compliance_requirements": "${finalState.collected?.compliance_requirements || 'unknown'}",
  "volume_discounts": "${finalState.collected?.volume_discounts || 'unknown'}",
  "next_steps": "${finalState.collected?.next_steps || 'unknown'}",
  "amazon_question_asked": true/false,
  "amazon_answer_truthful": true/false,
  "amazon_restriction_type": "none/absolute_ban/map_concern/pricing_concern/channel_conflict/case_by_case/unknown",
  "amazon_restriction_clarified": true/false,
  "is_fit_for_account": "yes/no/conditional",
  "red_flags_detected": ${JSON.stringify(finalState.redFlags || [])},
  "call_duration_seconds": ${callDuration},
  "professionalism_score": 0-10,
  "information_gathering_score": 0-10,
  "efficiency_score": 0-10,
  "credibility_score": 0-10,
  "closing_score": 0-10,
  "honesty_score": 0-10,
  "overall_score": 0-10
}
`}`;

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
  console.log(`✅ Vortex Live Call Copilot v8 running on port ${PORT}`);
  console.log(`✓ LIVE INTELLIGENCE TRACKING - Internal State Engine`);
  console.log(`✓ Real-time Mission Progress Tracking`);
  console.log(`✓ Red Flag Detection & Pause Logic`);
  console.log(`✓ Completion Percentage Calculation`);
  console.log(`✓ Highest Priority Missing Item Routing`);
});
