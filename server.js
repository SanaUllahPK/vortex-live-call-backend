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

// ═══════════════════════════════════════════════════════════════════════════════
// LIVE CALL INTELLIGENCE SCHEMA VERSION
// ═══════════════════════════════════════════════════════════════════════════════

const ANALYZE_LIVE_SCHEMA_VERSION = "1.0";

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Vortex Supplier Intelligence Platform v14 - Active" });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LIVE CALL INTELLIGENCE HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

// FUNCTION 1: findSupplier() - READ-ONLY supplier lookup
const findSupplier = async (companyName, supplierId) => {
  if (!companyName && !supplierId) return null;
  
  try {
    // Try: Find by normalized name variant
    if (companyName) {
      const normalized = normalizeSupplierName(companyName);
      const { data: variantMatch } = await supabase
        .from("supplier_name_variants")
        .select("canonical_supplier_id")
        .eq("normalized_version", normalized)
        .gte("confidence", 90)
        .limit(1);
      
      if (variantMatch?.length > 0) {
        return variantMatch[0].canonical_supplier_id;
      }
    }
    
    // Try: Find by exact company name
    if (companyName) {
      const { data: exactMatch } = await supabase
        .from("supplier_memory")
        .select("id")
        .eq("company_name", companyName)
        .limit(1);
      
      if (exactMatch?.length > 0) {
        return exactMatch[0].id;
      }
    }
    
    // Try: Find by supplier_id if provided
    if (supplierId) {
      const { data: idMatch } = await supabase
        .from("supplier_memory")
        .select("id")
        .eq("supplier_id", supplierId)
        .limit(1);
      
      if (idMatch?.length > 0) {
        return idMatch[0].id;
      }
    }
    
    // NOT FOUND - Return null (do NOT create)
    return null;
    
  } catch (error) {
    console.error("Supplier lookup error:", error);
    return null;
  }
};

// FUNCTION 2: extractCollectedInfo() - Extract known information from memory
const extractCollectedInfo = (memory) => {
  if (!memory) return [];
  
  const collected = [];
  
  if (memory.MOQ) collected.push(`MOQ: ${memory.MOQ} units`);
  if (memory.payment_terms) collected.push(`Payment terms: ${memory.payment_terms}`);
  if (memory.approval_timeline) collected.push(`Approval timeline: ${memory.approval_timeline}`);
  if (memory.lead_time) collected.push(`Lead time: ${memory.lead_time}`);
  if (memory.product_categories) collected.push(`Products: ${Array.isArray(memory.product_categories) ? memory.product_categories.join(", ") : memory.product_categories}`);
  if (memory.freight_terms) collected.push(`Freight: ${memory.freight_terms}`);
  if (memory.compliance_requirements) collected.push(`Compliance: ${memory.compliance_requirements}`);
  if (memory.volume_discount_tiers) collected.push(`Volume discounts available`);
  
  return collected;
};

// FUNCTION 3: extractMissingInfo() - Identify gaps in known information
const extractMissingInfo = (memory) => {
  if (!memory) {
    return [
      "All information unknown (first contact)",
      "Product categories not identified",
      "MOQ not established",
      "Pricing structure unknown",
      "Payment terms unclear",
      "Lead times unknown"
    ];
  }
  
  const missing = [];
  
  if (!memory.MOQ) missing.push("Minimum order quantity");
  if (!memory.payment_terms) missing.push("Payment terms and conditions");
  if (!memory.lead_time) missing.push("Lead time/fulfillment timeline");
  if (!memory.product_categories) missing.push("Specific product categories");
  if (!memory.compliance_requirements) missing.push("Quality certifications and compliance");
  if (!memory.freight_terms) missing.push("Shipping and freight terms");
  if (!memory.volume_discount_tiers) missing.push("Volume discount structure");
  
  if (memory.last_call_summary?.critical_gaps) {
    missing.push(...memory.last_call_summary.critical_gaps.filter(g => !missing.includes(g)));
  }
  
  return missing.slice(0, 10); // Return top 10 gaps
};

// FUNCTION 4: extractRiskFlags() - Extract known risks from memory
const extractRiskFlags = (memory) => {
  const flags = [];
  
  if (!memory) return [];
  
  if (memory.known_restrictions) {
    const restrictions = Array.isArray(memory.known_restrictions) 
      ? memory.known_restrictions 
      : [memory.known_restrictions];
    flags.push(...restrictions);
  }
  
  if (memory.last_call_summary?.risk_flags) {
    const callRisks = Array.isArray(memory.last_call_summary.risk_flags)
      ? memory.last_call_summary.risk_flags
      : [memory.last_call_summary.risk_flags];
    flags.push(...callRisks.filter(r => !flags.includes(r)));
  }
  
  return [...new Set(flags)]; // Deduplicate
};

// FUNCTION 5: extractSupplierSignals() - Extract positive and negative signals
const extractSupplierSignals = (memory) => {
  const signals = {
    positive: [],
    negative: []
  };
  
  if (!memory) return signals;
  
  if (memory.last_call_summary?.positive_signals) {
    signals.positive = Array.isArray(memory.last_call_summary.positive_signals)
      ? memory.last_call_summary.positive_signals
      : [memory.last_call_summary.positive_signals];
  }
  
  if (memory.last_call_summary?.risk_flags) {
    signals.negative = Array.isArray(memory.last_call_summary.risk_flags)
      ? memory.last_call_summary.risk_flags
      : [memory.last_call_summary.risk_flags];
  }
  
  if (memory.known_objections) {
    const objections = Array.isArray(memory.known_objections)
      ? memory.known_objections
      : [memory.known_objections];
    signals.negative.push(...objections.filter(o => !signals.negative.includes(o)));
  }
  
  return signals;
};

// FUNCTION 6: extractTranscriptSignals() - Deterministic signal extraction
const extractTranscriptSignals = (transcript, conversationHistory = null) => {
  // Deterministic extraction of signals from supplier message
  // Lightweight contextual assessment (pattern matching, not reasoning)
  
  const extractedClaims = [];
  const contextMetrics = {
    message_length: transcript.length,
    sentence_count: (transcript.match(/[.!?]/g) || []).length,
    question_count: (transcript.match(/\?/g) || []).length,
    explicit_commitment_count: 0
  };
  
  // Deterministic keyword/phrase detection
  const patterns = {
    moq: /MOQ[:\s]+(\d+)\s*(units?)?/i,
    pricing: /(price|cost|rate)[:\s]+\$?[\d.]+/i,
    lead_time: /(lead time|timeline|delivery)[:\s]+(\d+\s*\w+)?/i,
    capacity: /(capacity|supply|produce|manufacture)\s+.*?(\d+)\s*(units?)?/i,
    payment: /(payment|terms|upfront|deposit)/i,
    commitment: /(can|will|able|capable|ready|available)/i
  };
  
  // Extract explicit claims
  if (patterns.moq.test(transcript)) {
    const match = transcript.match(patterns.moq);
    extractedClaims.push({
      claim: `Has MOQ of ${match[1]} units`,
      confidence: "High",
      source: "explicit"
    });
  }
  
  if (patterns.capacity.test(transcript)) {
    extractedClaims.push({
      claim: "Has stated production capacity",
      confidence: "High",
      source: "explicit"
    });
  }
  
  if (patterns.lead_time.test(transcript)) {
    extractedClaims.push({
      claim: "Has specified lead time",
      confidence: "High",
      source: "explicit"
    });
  }
  
  if (patterns.payment.test(transcript)) {
    extractedClaims.push({
      claim: "Has addressed payment terms",
      confidence: "High",
      source: "explicit"
    });
  }
  
  // Assess response metrics
  const wordCount = transcript.split(/\s+/).length;
  const responseLength = wordCount > 50 ? "High" : wordCount > 20 ? "Medium" : "Low";
  const hasCounterQuestions = contextMetrics.question_count > 0;
  const hasCommitmentLanguage = patterns.commitment.test(transcript);
  
  if (hasCommitmentLanguage) {
    contextMetrics.explicit_commitment_count = (transcript.match(patterns.commitment) || []).length;
  }
  
  // Determine signal patterns
  const signalPatterns = {
    responsiveness: extractedClaims.length >= 2 ? "High" : extractedClaims.length === 1 ? "Medium" : "Low",
    information_density: responseLength,
    engagement_indicators: hasCounterQuestions ? "High" : hasCommitmentLanguage ? "Medium" : "Low",
    response_style: transcript.match(/^[A-Z]/m) && wordCount > 30 ? "Formal" : wordCount < 20 ? "Minimal" : "Casual"
  };
  
  // Pattern matching against known styles
  const isTone = {
    cooperative: /happy|pleased|glad|excellent|love|great/i.test(transcript),
    guarded: /cannot|unable|cannot|restricted|limited|conditions/i.test(transcript),
    dismissive: /unfortunately|we don't|not interested|prefer not/i.test(transcript),
    transactional: contextMetrics.sentence_count <= 3 && responseLength === "Low"
  };
  
  let bestMatch = "Transactional";
  if (isTone.cooperative) bestMatch = "Cooperative";
  if (isTone.guarded) bestMatch = "Guarded";
  if (isTone.dismissive) bestMatch = "Dismissive";
  
  const patternMatch = {
    best_match: bestMatch,
    confidence: extractedClaims.length >= 2 ? "High" : "Medium"
  };
  
  // Identify new gaps (what should have been mentioned)
  const newGaps = [];
  if (!patterns.pricing.test(transcript) && responseLength !== "Low") {
    newGaps.push("Pricing not mentioned");
  }
  if (!patterns.payment.test(transcript)) {
    newGaps.push("Payment terms not discussed");
  }
  if (!patterns.lead_time.test(transcript) && contextMetrics.sentence_count > 2) {
    newGaps.push("Lead time not specified");
  }
  
  return {
    extracted_claims: extractedClaims,
    signal_patterns: signalPatterns,
    context_metrics: contextMetrics,
    pattern_match: patternMatch,
    new_gaps_identified: newGaps
  };
};

// FUNCTION 7: analyzeConversationFlow() - Assess conversation progression
const analyzeConversationFlow = (conversationHistory, transcript) => {
  const messageCount = (conversationHistory || []).length + 1;
  
  let conversationFlowStage = "Opening";
  if (messageCount > 6) conversationFlowStage = "Closing";
  else if (messageCount > 4) conversationFlowStage = "Negotiation";
  else if (messageCount > 2) conversationFlowStage = "Discovery";
  
  // Determine next logical question based on stage
  let nextLogicalQuestion = "What are your basic specifications and MOQ?";
  if (messageCount > 2) nextLogicalQuestion = "What are your payment terms and approval timeline?";
  if (messageCount > 4) nextLogicalQuestion = "Can we discuss volume discounts and preferred delivery schedule?";
  if (messageCount > 6) nextLogicalQuestion = "When can we formalize this partnership?";
  
  return {
    conversation_flow_stage: conversationFlowStage,
    next_logical_question: nextLogicalQuestion,
    message_count: messageCount
  };
};

// FUNCTION 8: calculateSessionTrust() - Calculate live session trust heuristic
const calculateSessionTrust = (historicalTrustLevel, signalAnalysis, responsiveness, engagementLevel) => {
  // Session trust is HEURISTIC ONLY - never persisted, never overwrites historical trust
  
  let provisionalAdjustment = 0;
  
  // Adjust based on responsiveness
  if (responsiveness === "High") provisionalAdjustment += 1;
  if (responsiveness === "Low") provisionalAdjustment -= 1;
  
  // Adjust based on engagement
  if (engagementLevel === "High") provisionalAdjustment += 0.5;
  if (engagementLevel === "Low") provisionalAdjustment -= 0.5;
  
  // Adjust based on pattern match
  if (signalAnalysis.pattern_match.best_match === "Cooperative") provisionalAdjustment += 0.5;
  if (signalAnalysis.pattern_match.best_match === "Guarded") provisionalAdjustment -= 1;
  if (signalAnalysis.pattern_match.best_match === "Dismissive") provisionalAdjustment -= 2;
  
  // Adjust based on information density
  if (signalAnalysis.signal_patterns.information_density === "High") provisionalAdjustment += 0.5;
  if (signalAnalysis.signal_patterns.information_density === "Low") provisionalAdjustment -= 0.5;
  
  // Calculate session assessment
  const sessionTrustAssessment = Math.max(0, Math.min(10, historicalTrustLevel + provisionalAdjustment));
  
  return {
    historical_trust_level: historicalTrustLevel,
    provisional_adjustment: provisionalAdjustment,
    session_trust_assessment: sessionTrustAssessment,
    assessment_type: "Heuristic",
    assessment_note: "Advisory only. Historical trust is authoritative and never overwritten.",
    confidence: Math.abs(provisionalAdjustment) > 0.5 ? "High" : "Medium"
  };
};

// FUNCTION 9: determineConversationStage() - Assess conversation stage
const determineConversationStage = (memory, signalAnalysis, flowAnalysis) => {
  const currentStage = memory?.relationship_stage || "Prospect";
  
  let suggestedProgression = null;
  let progressionConfidence = "Low";
  let progressionReason = "";
  
  if (currentStage === "Prospect") {
    // If supplier provided MOQ/terms/capacity, suggest Contact
    if (signalAnalysis.extracted_claims.length >= 2) {
      suggestedProgression = "Contact";
      progressionConfidence = "High";
      progressionReason = "Supplier provided specific information (MOQ, capacity, terms)";
    }
  } else if (currentStage === "Contact") {
    // If supplier discussed detailed pricing/terms, suggest Interested
    if (signalAnalysis.extracted_claims.length >= 3) {
      suggestedProgression = "Interested";
      progressionConfidence = "Medium";
      progressionReason = "Supplier showed detailed engagement and multiple information points";
    }
  } else if (currentStage === "Interested") {
    // If supplier discussed approval process, suggest Approved
    if (signalAnalysis.signal_patterns.engagement_indicators === "High") {
      suggestedProgression = "Approved";
      progressionConfidence = "Medium";
      progressionReason = "Supplier showing high engagement and commitment indicators";
    }
  }
  
  return {
    current_stage: currentStage,
    suggested_progression: suggestedProgression,
    progression_confidence: progressionConfidence,
    progression_reason: progressionReason
  };
};

// FUNCTION 10: generateNextObjective() - Generate immediate next objective
const generateNextObjective = (memory, missingInfo, currentStage, signalAnalysis) => {
  const objectives = {
    "Prospect": "Qualify product fit and verify manufacturing capability",
    "Contact": "Establish MOQ, pricing structure, and volume discounts",
    "Interested": "Clarify payment terms, approval process, and timeline",
    "Approved": "Finalize ordering process and establish regular communication cadence"
  };
  
  let nextObjective = objectives[currentStage] || objectives["Prospect"];
  
  // Override with message context if supplier raised objections
  if (signalAnalysis.pattern_match.best_match === "Guarded") {
    nextObjective = "Address supplier concerns and clarify partnership benefits";
  }
  
  if (signalAnalysis.pattern_match.best_match === "Dismissive") {
    nextObjective = "Re-assess fit or seek alternative suppliers";
  }
  
  return nextObjective;
};

// FUNCTION 11: generateSuggestedQuestion() - Generate discovery question
const generateSuggestedQuestion = (missingInfo, nextObjective, signalAnalysis, memory) => {
  // Prioritize based on missing info and next objective
  let suggestedQuestion = "Could you provide more details about your standard terms and conditions?";
  
  if (nextObjective.includes("MOQ")) {
    suggestedQuestion = "Could you share your MOQ and pricing structure for volume orders?";
  } else if (nextObjective.includes("payment")) {
    suggestedQuestion = "What are your standard payment terms, and do you accommodate net payment terms?";
  } else if (nextObjective.includes("approval")) {
    suggestedQuestion = "Could you walk us through your supplier approval process and typical timeline?";
  } else if (nextObjective.includes("Address")) {
    suggestedQuestion = "What are the main concerns you have about this partnership, and how can we address them?";
  }
  
  return suggestedQuestion;
};

// FUNCTION 12: combineInsights() - Orchestrate insight combination
const combineInsights = (memory, signalAnalysis, flowAnalysis, currentStage, historicalTrustLevel, missingInfo) => {
  // Calculate session trust
  const trustAssessment = calculateSessionTrust(
    historicalTrustLevel,
    signalAnalysis,
    signalAnalysis.signal_patterns.responsiveness,
    signalAnalysis.signal_patterns.engagement_indicators
  );
  
  // Determine conversation stage
  const stageAssessment = determineConversationStage(memory, signalAnalysis, flowAnalysis);
  
  // Generate next objective
  const nextObjective = generateNextObjective(memory, missingInfo, stageAssessment.current_stage, signalAnalysis);
  
  // Generate suggested question
  const suggestedQuestion = generateSuggestedQuestion(missingInfo, nextObjective, signalAnalysis, memory);
  
  // Consolidate risk alerts
  const riskAlerts = [];
  if (signalAnalysis.pattern_match.best_match === "Guarded") {
    riskAlerts.push("Supplier showing guarded communication - may have restrictions");
  }
  if (missingInfo.includes("Quality certifications and compliance")) {
    riskAlerts.push("No compliance certifications mentioned - verify before proceeding");
  }
  if (signalAnalysis.new_gaps_identified.length > 0) {
    riskAlerts.push(`Missing information: ${signalAnalysis.new_gaps_identified.join(", ")}`);
  }
  
  // Extract positive indicators
  const positiveIndicators = [];
  if (signalAnalysis.pattern_match.best_match === "Cooperative") {
    positiveIndicators.push("Supplier showing cooperative and engaged communication");
  }
  if (signalAnalysis.signal_patterns.responsiveness === "High") {
    positiveIndicators.push("Supplier provided comprehensive response with specific details");
  }
  if (signalAnalysis.context_metrics.explicit_commitment_count > 0) {
    positiveIndicators.push("Supplier using commitment language (can, will, able to)");
  }
  
  return {
    current_assessment: {
      stage: stageAssessment.current_stage,
      historical_trust_level: trustAssessment.historical_trust_level,
      provisional_adjustment: trustAssessment.provisional_adjustment,
      session_trust_assessment: trustAssessment.session_trust_assessment,
      assessment_type: trustAssessment.assessment_type,
      assessment_note: trustAssessment.assessment_note,
      information_status: missingInfo.length < 3 ? "Comprehensive" : missingInfo.length < 6 ? "Moderate" : "Limited"
    },
    immediate_next_step: nextObjective,
    suggested_discovery_question: suggestedQuestion,
    suggested_progression: stageAssessment.suggested_progression,
    progression_confidence: stageAssessment.progression_confidence,
    progression_reason: stageAssessment.progression_reason,
    risk_alerts: riskAlerts,
    positive_indicators: positiveIndicators
  };
};

// FUNCTION 13: buildIntelligenceSources() - Create attribution map
const buildIntelligenceSources = (supplierFound, hasMemory) => {
  return {
    supplier_found: {
      source: "findSupplier() lookup",
      method: "Database query (read-only)",
      confidence: "High"
    },
    memory_based_insights: {
      source: "supplier_memory table + last_call_summary",
      method: "Direct field retrieval",
      confidence: "High"
    },
    transcript_signals: {
      source: "Current transcript + conversationHistory",
      method: "Deterministic signal extraction",
      confidence: "Medium",
      note: "Pattern matching and explicit statement detection, not LLM analysis"
    },
    historical_trust_level: {
      source: "supplier_memory.trust_score",
      type: "Authoritative",
      confidence: "High",
      note: "Persisted across all interactions, never overwritten by session assessment"
    },
    session_trust_assessment: {
      source: "calculateSessionTrust() heuristic",
      type: "Advisory",
      confidence: "Medium",
      note: "Live-call assessment only, never persisted to database"
    },
    combined_recommendation: {
      source: "memory_based_insights + transcript_signals merged",
      method: "Integration logic",
      confidence: "Medium",
      rationale: "Combines high-confidence memory with medium-confidence signal analysis"
    }
  };
};

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/analyze-live ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/analyze-live", async (req, res) => {
  try {
    // STEP 1: Parse request
    const { companyName, supplierId, callType, transcript, conversationHistory } = req.body;
    
    // STEP 2: Validate input
    if (!companyName || !callType || !transcript) {
      return res.status(400).json({ error: "companyName, callType, transcript required" });
    }
    
    // STEP 3: Resolve supplier - READ ONLY (no creates)
    const supplierUuid = await findSupplier(companyName, supplierId);
    const supplierFound = !!supplierUuid;
    
    // STEP 4: Load memory if supplier found - READ ONLY
    let memory = null;
    if (supplierFound) {
      memory = await loadSupplierMemory(supplierUuid);
    }
    
    // STEP 5: Extract memory-based insights
    const currentStage = memory?.relationship_stage || "Prospect";
    const historicalTrustLevel = memory?.trust_score || 5;
    const memoryBasedInsights = {
      current_stage: currentStage,
      historical_trust_level: historicalTrustLevel,
      previously_collected: extractCollectedInfo(memory),
      known_gaps: extractMissingInfo(memory),
      historical_risk_flags: extractRiskFlags(memory),
      known_objections: memory?.known_objections || [],
      known_restrictions: memory?.known_restrictions || []
    };
    
    // STEP 6: Analyze transcript signals - deterministic extraction
    const signalAnalysis = extractTranscriptSignals(transcript);
    const flowAnalysis = analyzeConversationFlow(conversationHistory || [], transcript);
    
    // STEP 7: Extract missing info (for use in combining)
    const missingInfo = extractMissingInfo(memory);
    
    // STEP 8: Build message-based insights
    const messageBasedInsights = {
      extracted_claims: signalAnalysis.extracted_claims,
      signal_patterns: signalAnalysis.signal_patterns,
      context_metrics: signalAnalysis.context_metrics,
      pattern_match: signalAnalysis.pattern_match,
      new_gaps_identified: signalAnalysis.new_gaps_identified,
      conversation_flow_stage: flowAnalysis.conversation_flow_stage,
      next_logical_question: flowAnalysis.next_logical_question
    };
    
    // STEP 9: Combine insights using helper functions
    const combinedRecommendation = combineInsights(
      memory,
      signalAnalysis,
      flowAnalysis,
      currentStage,
      historicalTrustLevel,
      missingInfo
    );
    
    // STEP 10: Build intelligence sources attribution
    const intelligenceSources = buildIntelligenceSources(supplierFound, !!memory);
    
    // STEP 11: Return response - NO DATABASE WRITES
    res.json({
      schema_version: ANALYZE_LIVE_SCHEMA_VERSION,
      supplier_found: supplierFound,
      supplier_id: supplierUuid || null,
      memory_based_insights: supplierFound ? memoryBasedInsights : {},
      message_based_insights: messageBasedInsights,
      combined_recommendation: combinedRecommendation,
      intelligence_sources: intelligenceSources,
      timestamp: new Date().toISOString(),
      callType: callType
    });
    
  } catch (error) {
    console.error("Live call analysis error:", error);
    res.status(500).json({ error: "Failed to analyze call", details: error.message });
  }
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
  console.log(`✓ Endpoints: /api/analyze-live (NEW), /api/analyze-supplier-message, /api/call-summary, /api/learning/questions`);
  console.log(`✓ /api/analyze-live: Read-only Live Call Intelligence - Phase 1`);
});
