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
  return name
    .toLowerCase()
    .replace(/\b(llc|inc|corp|co|ltd|company|inc\.|co\.|llc\.|distributor|dist|distribution|dist\.)(\s|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 1: HELPER FUNCTIONS (Existing)
// ═══════════════════════════════════════════════════════════════════════════════

const findSupplier = async (companyName) => {
  const normalizedName = normalizeSupplierName(companyName);
  if (!normalizedName) return null;

  try {
    const { data } = await supabase
      .from("supplier_memory")
      .select("*")
      .eq("name", normalizedName)
      .single();

    return data || null;
  } catch (error) {
    return null;
  }
};

const loadSupplierMemory = async (supplierUuid) => {
  if (!supplierUuid) return null;
  try {
    const { data } = await supabase
      .from("supplier_memory")
      .select("*")
      .eq("id", supplierUuid)
      .single();

    return data || null;
  } catch (error) {
    return null;
  }
};

const extractCollectedInfo = (memory) => {
  if (!memory) return [];
  return [
    memory.product_category,
    memory.minimum_order_quantity,
    memory.lead_time_days,
    memory.pricing_structure,
    memory.quality_certifications,
    memory.payment_terms,
    memory.shipping_options,
    memory.return_policy,
  ].filter(Boolean);
};

const extractMissingInfo = (memory, transcript) => {
  const missing = [];
  const lowerTranscript = transcript.toLowerCase();

  const fields = [
    { name: "Pricing details", keywords: ["price", "cost", "rate", "$", "¥", "€"] },
    { name: "Minimum order quantities", keywords: ["minimum", "moq", "min order"] },
    { name: "Lead times", keywords: ["delivery", "lead", "ship", "timeline"] },
    { name: "Quality certifications", keywords: ["iso", "cert", "quality", "standard"] },
    { name: "Payment terms", keywords: ["payment", "terms", "net 30", "deposit"] },
    { name: "Shipping options", keywords: ["ship", "freight", "logistics", "fob"] },
    { name: "Return policy", keywords: ["return", "refund", "warranty"] },
  ];

  fields.forEach(({ name, keywords }) => {
    const hasKeywords = keywords.some((kw) => lowerTranscript.includes(kw));
    if (!hasKeywords) {
      missing.push(name);
    }
  });

  return missing;
};

const extractRiskFlags = (memory) => {
  if (!memory) return [];
  return memory.risk_flags || [];
};

const extractSupplierSignals = (memory) => {
  if (!memory) return {};
  return {
    approval_rate: memory.effective_approval_rate || 0.5,
    average_trust_score: memory.trust_score || 5,
    known_objections: memory.known_objections || [],
    known_restrictions: memory.known_restrictions || [],
  };
};

const extractTranscriptSignals = (transcript) => {
  const lowerTranscript = transcript.toLowerCase();

  const signals = {
    responsiveness: lowerTranscript.length > 100 ? "High" : lowerTranscript.length > 30 ? "Medium" : "Low",
    information_density:
      (lowerTranscript.match(/\d+/g) || []).length > 3 ? "High" : 
      (lowerTranscript.match(/\d+/g) || []).length > 0 ? "Medium" : "Low",
    engagement_indicators:
      lowerTranscript.includes("we can") || lowerTranscript.includes("we offer")
        ? "Positive"
        : lowerTranscript.includes("unfortunately") || lowerTranscript.includes("cannot")
        ? "Hesitant"
        : "Neutral",
    response_style: lowerTranscript.includes("question") ? "Curious" : "Direct",
  };

  return {
    extracted_claims: [
      ...new Set(
        transcript
          .match(/(?:we|our|our company).*?(?:\.|,|;)/gi)
          ?.slice(0, 5) || []
      ),
    ],
    signal_patterns: signals,
    context_metrics: {
      message_length: transcript.length,
      sentence_count: (transcript.match(/[.!?]/g) || []).length,
      question_count: (transcript.match(/\?/g) || []).length,
      explicit_commitment_count: (transcript.match(/can|will|able/gi) || []).length,
    },
    pattern_match: {
      best_match: signals.engagement_indicators === "Positive" ? "Cooperative" : "Guarded",
      confidence: "Medium",
    },
    new_gaps_identified: [],
    conversation_flow_stage: "Initial",
    next_logical_question: "Could you provide more details about your standard terms?",
  };
};

const analyzeConversationFlow = (conversationHistory) => {
  const length = conversationHistory?.length || 0;
  return {
    turns_so_far: length,
    engagement_trend: length > 3 ? "Deepening" : "Early",
    momentum: length > 2 ? "Building" : "Establishing",
  };
};

const calculateSessionTrust = (historicalTrustLevel, signalAnalysis, responsiveness, engagementIndicators) => {
  const baseTrust = historicalTrustLevel || 5;
  const adjustmentUp = responsiveness === "High" ? 1 : responsiveness === "Medium" ? 0.5 : 0;
  const adjustmentDown = engagementIndicators === "Hesitant" ? -1 : engagementIndicators === "Neutral" ? -0.5 : 0;

  return {
    historical_trust_level: baseTrust,
    provisional_adjustment: adjustmentUp + adjustmentDown,
    session_trust_assessment: Math.max(1, Math.min(10, baseTrust + adjustmentUp + adjustmentDown)),
    assessment_type: "Heuristic",
    assessment_note: "Advisory only - never persisted to database",
  };
};

const determineConversationStage = (memory, signalAnalysis, flowAnalysis) => {
  const stage = signalAnalysis.conversation_flow_stage || "Initial";
  return {
    current_stage: stage,
    suggested_progression: stage === "Initial" ? "Discovery" : "Negotiation",
    progression_confidence: "Medium",
    progression_reason: "Supplier showing engagement",
  };
};

const generateNextObjective = (memory, missingInfo, currentStage, signalAnalysis) => {
  if (missingInfo.length > 5) {
    return "Gather critical information (pricing, MOQ, lead times)";
  }
  if (missingInfo.length > 2) {
    return "Clarify remaining details";
  }
  return "Move toward partnership agreement";
};

const generateSuggestedQuestion = (missingInfo, nextObjective, signalAnalysis, memory) => {
  if (missingInfo.includes("Pricing details")) {
    return "Can you provide your pricing structure and any volume discounts?";
  }
  if (missingInfo.includes("Minimum order quantities")) {
    return "What is your minimum order quantity?";
  }
  if (missingInfo.includes("Lead times")) {
    return "What are your typical lead times for delivery?";
  }
  return "Could you provide more details about your standard terms and conditions?";
};

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2: LOCATION 1 - INTELLIGENCE LOADING FUNCTIONS (7 functions)
// ═══════════════════════════════════════════════════════════════════════════════

const getOpenQuestions = async (supplierUuid) => {
  if (!supplierUuid) return null;
  try {
    const { data } = await supabase
      .from("supplier_memory")
      .select("open_questions")
      .eq("id", supplierUuid)
      .single();
    if (data && data.open_questions) {
      return {
        questions: Array.isArray(data.open_questions) ? data.open_questions : [data.open_questions],
        count: data.open_questions ? (Array.isArray(data.open_questions) ? data.open_questions.length : 1) : 0,
        gating_status: "Always (no threshold)",
        created_at: data.created_at,
        updated_at: data.updated_at
      };
    }
    return null;
  } catch (error) {
    console.error("Error loading open questions:", error);
    return null;
  }
};

const getCategoryIntelligence = async (supplierCategory) => {
  if (!supplierCategory) return null;
  try {
    const { data } = await supabase
      .from("category_intelligence")
      .select("*")
      .eq("supplier_category", supplierCategory)
      .single();
    if (data) {
      const age_days = Math.floor((Date.now() - new Date(data.updated_at).getTime()) / (1000 * 60 * 60 * 24));
      return {
        category: data.supplier_category,
        approval_rate: data.effective_approval_rate || 0.5,
        objections: data.most_common_objections || [],
        sample_size: data.sample_size || 0,
        confidence_tier: data.confidence_level || "Unknown",
        age_days: age_days,
        created_at: data.created_at,
        updated_at: data.updated_at,
        gating_status: (data.sample_size || 0) >= 20 ? "Passed" : "Below threshold"
      };
    }
    return null;
  } catch (error) {
    console.error("Error loading category intelligence:", error);
    return null;
  }
};

const getRejectionPatterns = async (supplierCategory) => {
  if (!supplierCategory) return null;
  try {
    const { data } = await supabase
      .from("rejection_intelligence")
      .select("*")
      .eq("supplier_category", supplierCategory)
      .single();
    if (data) {
      const age_days = Math.floor((Date.now() - new Date(data.updated_at).getTime()) / (1000 * 60 * 60 * 24));
      return {
        category: data.supplier_category,
        reasons: data.most_common_rejection_reasons || [],
        frequency: data.frequency_distribution || {},
        sample_size: data.sample_size || 0,
        confidence_tier: data.confidence_level || "Unknown",
        age_days: age_days,
        created_at: data.created_at,
        updated_at: data.updated_at,
        gating_status: (data.sample_size || 0) >= 20 ? "Passed" : "Below threshold"
      };
    }
    return null;
  } catch (error) {
    console.error("Error loading rejection patterns:", error);
    return null;
  }
};

const getSuccessPatterns = async (supplierCategory) => {
  if (!supplierCategory) return null;
  try {
    const { data } = await supabase
      .from("success_intelligence")
      .select("*")
      .eq("supplier_category", supplierCategory)
      .single();
    if (data) {
      const age_days = Math.floor((Date.now() - new Date(data.updated_at).getTime()) / (1000 * 60 * 60 * 24));
      return {
        category: data.supplier_category,
        approval_rate: data.approval_rate || 0.5,
        signals: data.common_success_signals || [],
        factors: data.success_factors || [],
        sample_size: data.sample_size || 0,
        confidence_tier: data.confidence_level || "Unknown",
        age_days: age_days,
        created_at: data.created_at,
        updated_at: data.updated_at,
        gating_status: (data.sample_size || 0) >= 20 ? "Passed" : "Below threshold"
      };
    }
    return null;
  } catch (error) {
    console.error("Error loading success patterns:", error);
    return null;
  }
};

const getSupplierBehaviorProfile = async (supplierUuid) => {
  if (!supplierUuid) return null;
  try {
    const { data } = await supabase
      .from("supplier_behavior_profile")
      .select("*")
      .eq("supplier_id", supplierUuid)
      .single();
    if (data) {
      const age_days = Math.floor((Date.now() - new Date(data.updated_at).getTime()) / (1000 * 60 * 60 * 24));
      return {
        communication_style: data.communication_style || "Unknown",
        approval_speed: data.approval_speed || "Unknown",
        negotiation_pattern: data.negotiation_pattern || "Unknown",
        reliability: data.payment_reliability || 0.5,
        responsiveness: data.responsiveness || "Unknown",
        sample_size: data.sample_interactions || 0,
        confidence_tier: data.confidence_level || "Unknown",
        age_days: age_days,
        created_at: data.created_at,
        updated_at: data.updated_at,
        gating_status: (data.sample_interactions || 0) >= 20 ? "Passed" : "Below threshold"
      };
    }
    return null;
  } catch (error) {
    console.error("Error loading behavior profile:", error);
    return null;
  }
};

const getQuestionEffectiveness = async (supplierUuid, supplierCategory) => {
  try {
    const queries = [];
    
    if (supplierUuid) {
      const { data: supplierQuestions } = await supabase
        .from("question_tracking")
        .select("*")
        .eq("supplier_id", supplierUuid)
        .gte("sample_size", 20)
        .order("effectiveness_score", { ascending: false })
        .limit(5);
      if (supplierQuestions) queries.push(...supplierQuestions);
    }
    
    if (supplierCategory) {
      const { data: categoryQuestions } = await supabase
        .from("question_tracking")
        .select("*")
        .eq("category", supplierCategory)
        .gte("sample_size", 20)
        .order("effectiveness_score", { ascending: false })
        .limit(5);
      if (categoryQuestions) {
        queries.push(...categoryQuestions.filter(q => !queries.find(sq => sq.id === q.id)));
      }
    }
    
    if (queries.length === 0) return null;
    
    return {
      questions: queries.map(q => ({
        question: q.question_text,
        effectiveness_score: q.effectiveness_score || 0,
        trust_impact: q.trust_impact || 0,
        approval_impact: q.approval_impact || 0,
        sample_size: q.sample_size || 0,
        source: q.supplier_id ? "supplier_specific" : "category"
      })),
      count: queries.length,
      gating_status: "Passed (sample >= 20 enforced)"
    };
  } catch (error) {
    console.error("Error loading question effectiveness:", error);
    return null;
  }
};

const getOpenQuestionsForCategory = async (supplierCategory) => {
  if (!supplierCategory) return null;
  try {
    const { data } = await supabase
      .from("question_tracking")
      .select("*")
      .eq("category", supplierCategory)
      .eq("is_open_question", true)
      .gte("sample_size", 20)
      .order("approval_impact", { ascending: false })
      .limit(5);
    if (data && data.length > 0) {
      return {
        questions: data.map(q => ({
          question: q.question_text,
          priority: q.priority || "Medium",
          approval_impact: q.approval_impact || 0
        })),
        count: data.length,
        gating_status: "Passed (sample >= 20 enforced)"
      };
    }
    return null;
  } catch (error) {
    console.error("Error loading category open questions:", error);
    return null;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2: LOCATION 2 - INTEGRATION FUNCTIONS (7 functions)
// ═══════════════════════════════════════════════════════════════════════════════

const enrichMemoryWithOpenQuestions = (memoryInsights, openQuestions) => {
  if (!openQuestions || openQuestions.count === 0) return memoryInsights;
  
  return {
    ...memoryInsights,
    open_questions: openQuestions.questions,
    open_questions_count: openQuestions.count,
    note: "Supplier has documented open questions that should be addressed"
  };
};

const enrichWithBehaviorProfile = (recommendation, behaviorProfile) => {
  if (!behaviorProfile || behaviorProfile.gating_status !== "Passed") return recommendation;
  
  const styleAdjustments = {
    "Direct": "Use direct, fact-based questions. Avoid lengthy preamble.",
    "Analytical": "Provide data-driven questions with supporting metrics.",
    "Relationship-oriented": "Build rapport first, focus on partnership benefits.",
    "Formal": "Use formal language, respect hierarchy and processes.",
    "Flexible": "Adapt approach based on their responsiveness."
  };
  
  return {
    ...recommendation,
    recommendation_style: styleAdjustments[behaviorProfile.communication_style] || "Standard professional approach",
    suggested_question_style: behaviorProfile.communication_style
  };
};

const enrichWithSuccessPatterns = (recommendation, successPatterns) => {
  if (!successPatterns || successPatterns.gating_status !== "Passed") return recommendation;
  
  return {
    ...recommendation,
    success_factors: successPatterns.factors,
    historical_approval_rate: successPatterns.approval_rate,
    positive_indicators: [
      ...(recommendation.positive_indicators || []),
      ...successPatterns.signals.map(s => `Category success factor: ${s}`)
    ]
  };
};

const enrichWithRejectionPatterns = (recommendation, rejectionPatterns) => {
  if (!rejectionPatterns || rejectionPatterns.gating_status !== "Below threshold") {
    if (rejectionPatterns && rejectionPatterns.gating_status === "Passed") {
      return {
        ...recommendation,
        risk_alerts: [
          ...(recommendation.risk_alerts || []),
          `Category rejection pattern: ${rejectionPatterns.reasons.join(", ")}`
        ],
        category_rejection_rate: rejectionPatterns.frequency
      };
    }
  }
  return recommendation;
};

const selectBestQuestion = (openQuestions, behaviorProfile, questionEffectiveness, supplierMemory) => {
  if (openQuestions && openQuestions.count > 0) {
    const topQuestion = openQuestions.questions[0];
    return {
      question: topQuestion.question || topQuestion,
      source: "supplier_open_questions",
      priority: "High (supplier-specific)"
    };
  }
  
  if (questionEffectiveness && questionEffectiveness.count > 0) {
    const topQuestion = questionEffectiveness.questions[0];
    return {
      question: topQuestion.question,
      effectiveness_score: topQuestion.effectiveness_score,
      source: `${topQuestion.source}_effectiveness`,
      priority: "High (proven effective)"
    };
  }
  
  if (behaviorProfile && behaviorProfile.communication_style === "Analytical") {
    return {
      question: "Could you share specific data on your production capacity and quality metrics?",
      source: "behavior_adapted",
      priority: "Medium (style-specific)"
    };
  }
  
  return {
    question: "Could you provide more details about your standard terms and conditions?",
    source: "default",
    priority: "Low (default)"
  };
};

const combineInsights = (memory, signalAnalysis, flowAnalysis, currentStage, historicalTrustLevel, missingInfo, intelligence) => {
  let trustAssessment = calculateSessionTrust(
    historicalTrustLevel,
    signalAnalysis,
    signalAnalysis.signal_patterns.responsiveness,
    signalAnalysis.signal_patterns.engagement_indicators
  );
  
  let stageAssessment = determineConversationStage(memory, signalAnalysis, flowAnalysis);
  let nextObjective = generateNextObjective(memory, missingInfo, stageAssessment.current_stage, signalAnalysis);
  let suggestedQuestion = generateSuggestedQuestion(missingInfo, nextObjective, signalAnalysis, memory);
  
  if (intelligence) {
    if (intelligence.openQuestions && intelligence.openQuestions.budget_status === "ACTIVE") {
      suggestedQuestion = selectBestQuestion(
        intelligence.openQuestions,
        intelligence.supplierBehaviorProfile,
        intelligence.questionEffectiveness,
        memory
      );
    }
  }
  
  const riskAlerts = [];
  const positiveIndicators = [];
  
  if (signalAnalysis.pattern_match.best_match === "Guarded") {
    riskAlerts.push("Supplier showing guarded communication - may have restrictions");
  }
  if (missingInfo.includes("Quality certifications and compliance")) {
    riskAlerts.push("No compliance certifications mentioned - verify before proceeding");
  }
  
  if (signalAnalysis.pattern_match.best_match === "Cooperative") {
    positiveIndicators.push("Supplier showing cooperative and engaged communication");
  }
  if (signalAnalysis.signal_patterns.responsiveness === "High") {
    positiveIndicators.push("Supplier provided comprehensive response with specific details");
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
    suggested_discovery_question: typeof suggestedQuestion === 'string' ? suggestedQuestion : suggestedQuestion.question,
    suggested_progression: stageAssessment.suggested_progression,
    progression_confidence: stageAssessment.progression_confidence,
    progression_reason: stageAssessment.progression_reason,
    risk_alerts: riskAlerts,
    positive_indicators: positiveIndicators
  };
};

const buildIntelligenceSources = (supplierFound, hasMemory, intelligence) => {
  const sources = {
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
  
  if (intelligence) {
    if (intelligence.openQuestions) {
      sources.open_questions = {
        source: "supplier_memory.open_questions",
        budget_status: intelligence.openQuestions.budget_status,
        budget_position: 2,
        type: intelligence.openQuestions.budget_status === "ACTIVE" ? "Decision Influencer" : "Informational"
      };
    }
    
    if (intelligence.supplierBehaviorProfile) {
      sources.supplier_behavior_profile = {
        source: "supplier_behavior_profile table",
        budget_status: intelligence.supplierBehaviorProfile.budget_status,
        budget_position: 3,
        type: intelligence.supplierBehaviorProfile.budget_status === "ACTIVE" ? "Decision Influencer" : "Informational"
      };
    }
    
    if (intelligence.successPatterns) {
      sources.success_patterns = {
        source: "success_intelligence table",
        budget_status: intelligence.successPatterns.budget_status,
        budget_position: 4,
        type: intelligence.successPatterns.budget_status === "ACTIVE" ? "Decision Influencer" : "Informational"
      };
    }
    
    if (intelligence.questionEffectiveness) {
      sources.question_effectiveness = {
        source: "question_tracking table",
        budget_status: intelligence.questionEffectiveness.gating_status,
        budget_position: 5,
        type: intelligence.questionEffectiveness.gating_status === "Passed" ? "Decision Influencer" : "Informational"
      };
    }
    
    if (intelligence.categoryIntel) {
      sources.category_intelligence = {
        source: "category_intelligence table",
        budget_status: intelligence.categoryIntel.gating_status,
        budget_position: 6,
        type: intelligence.categoryIntel.gating_status === "Passed" ? "Supplementary" : "Informational"
      };
    }
    
    if (intelligence.rejectionPatterns) {
      sources.rejection_patterns = {
        source: "rejection_intelligence table",
        budget_status: intelligence.rejectionPatterns.gating_status,
        budget_position: 7,
        type: "Informational"
      };
    }
  }
  
  return sources;
};

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2: LOCATION 3 - GATING & VALIDATION FUNCTIONS (5 functions)
// ═══════════════════════════════════════════════════════════════════════════════

const applyGatingRule = (data, threshold = 20) => {
  if (!data) return { gated: false, tier: "No Data" };
  
  const sampleSize = data.sample_size || 0;
  
  if (sampleSize < 10) {
    return { gated: false, tier: "Experimental", sample_size: sampleSize };
  }
  if (sampleSize < 20) {
    return { gated: false, tier: "Emerging Pattern", sample_size: sampleSize };
  }
  if (sampleSize < 50) {
    return { gated: true, tier: "Validated Pattern", sample_size: sampleSize };
  }
  if (sampleSize < 100) {
    return { gated: true, tier: "Strong Pattern", sample_size: sampleSize };
  }
  return { gated: true, tier: "Proven Pattern", sample_size: sampleSize };
};

const applyIntelligenceBudget = (allIntelligence) => {
  const budgetedIntelligence = {
    budget_limit: 5,
    active_sources: [],
    informational_sources: [],
    intelligence_map: {}
  };
  
  if (allIntelligence.openQuestions) {
    budgetedIntelligence.intelligence_map.openQuestions = {
      ...allIntelligence.openQuestions,
      budget_status: "ACTIVE",
      budget_position: 2
    };
    budgetedIntelligence.active_sources.push("open_questions");
  }
  
  if (allIntelligence.supplierBehaviorProfile) {
    budgetedIntelligence.intelligence_map.supplierBehaviorProfile = {
      ...allIntelligence.supplierBehaviorProfile,
      budget_status: "ACTIVE",
      budget_position: 3
    };
    budgetedIntelligence.active_sources.push("supplier_behavior_profile");
  }
  
  if (allIntelligence.successPatterns) {
    budgetedIntelligence.intelligence_map.successPatterns = {
      ...allIntelligence.successPatterns,
      budget_status: "ACTIVE",
      budget_position: 4
    };
    budgetedIntelligence.active_sources.push("success_patterns");
  }
  
  if (allIntelligence.questionEffectiveness) {
    budgetedIntelligence.intelligence_map.questionEffectiveness = {
      ...allIntelligence.questionEffectiveness,
      budget_status: allIntelligence.questionEffectiveness.gating_status,
      budget_position: 5
    };
    if (allIntelligence.questionEffectiveness.gating_status === "Passed") {
      budgetedIntelligence.active_sources.push("question_effectiveness");
    } else {
      budgetedIntelligence.informational_sources.push("question_effectiveness");
    }
  }
  
  if (allIntelligence.categoryIntel) {
    budgetedIntelligence.intelligence_map.categoryIntel = {
      ...allIntelligence.categoryIntel,
      budget_status: "INFORMATIONAL",
      budget_position: 6
    };
    budgetedIntelligence.informational_sources.push("category_intelligence");
  }
  
  if (allIntelligence.rejectionPatterns) {
    budgetedIntelligence.intelligence_map.rejectionPatterns = {
      ...allIntelligence.rejectionPatterns,
      budget_status: "INFORMATIONAL",
      budget_position: 7
    };
    budgetedIntelligence.informational_sources.push("rejection_patterns");
  }
  
  return budgetedIntelligence;
};

const calculateDataFreshness = (timestamp) => {
  if (!timestamp) return null;
  
  const ageDays = Math.floor((Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60 * 24));
  
  let freshnessTier = "Stale";
  let recommendation_usage = "Deprecated";
  
  if (ageDays <= 30) {
    freshnessTier = "Fresh";
    recommendation_usage = "Direct";
  } else if (ageDays <= 90) {
    freshnessTier = "Current";
    recommendation_usage = "Direct";
  } else if (ageDays <= 180) {
    freshnessTier = "Recent";
    recommendation_usage = "Informational";
  } else {
    freshnessTier = "Stale";
    recommendation_usage = "Deprecated";
  }
  
  return {
    age_days: ageDays,
    freshness_tier: freshnessTier,
    recommendation_usage: recommendation_usage,
    last_updated: timestamp
  };
};

const executeQueryWithTimeout = async (queryPromise, timeoutMs = 500) => {
  try {
    return await Promise.race([
      queryPromise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('timeout')), timeoutMs)
      )
    ]);
  } catch (error) {
    if (error.message === 'timeout') {
      console.warn(`Intelligence query timeout after ${timeoutMs}ms`);
      return null;
    }
    throw error;
  }
};

const applyFreshnessScore = (baseConfidence, freshness) => {
  if (!freshness) return baseConfidence;
  
  let penalty = 0;
  
  if (freshness.freshness_tier === "Fresh") {
    penalty = 0;
  } else if (freshness.freshness_tier === "Current") {
    penalty = 0;
  } else if (freshness.freshness_tier === "Recent") {
    penalty = 0.05;
  } else if (freshness.freshness_tier === "Stale") {
    penalty = 0.20;
  }
  
  return Math.max(0, Math.min(1, baseConfidence - penalty));
};

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2: LOCATION 4 - CONFIDENCE & CONFLICT FUNCTIONS (7 functions)
// ═══════════════════════════════════════════════════════════════════════════════

const calculateContradictionScore = (conflicts, totalSources) => {
  if (!conflicts || conflicts.length === 0) return 1.0;
  
  const contradictionRatio = conflicts.length / Math.max(totalSources, 1);
  
  if (contradictionRatio === 0) return 1.0;
  if (contradictionRatio < 0.1) return 0.95;
  if (contradictionRatio < 0.25) return 0.75;
  if (contradictionRatio >= 0.25) return 0.4;
  return 0.5;
};

const calculateConfidenceScore = (confidenceComponents) => {
  const {
    freshness_score = 0.8,
    sample_size_score = 0.6,
    supplier_specificity_score = 0.7,
    contradiction_score = 1.0,
    historical_alignment_score = 0.7
  } = confidenceComponents;
  
  const overall_confidence = (
    (freshness_score * 0.20) +
    (sample_size_score * 0.25) +
    (supplier_specificity_score * 0.30) +
    (contradiction_score * 0.15) +
    (historical_alignment_score * 0.10)
  );
  
  return Math.max(0, Math.min(1, overall_confidence));
};

const assignConfidenceTier = (confidenceScore) => {
  if (confidenceScore >= 0.85) return "Very High";
  if (confidenceScore >= 0.70) return "High";
  if (confidenceScore >= 0.55) return "Good";
  if (confidenceScore >= 0.40) return "Moderate";
  return "Low";
};

const buildConfidenceBreakdown = (components) => {
  return {
    data_freshness: components.freshness_score || 0.8,
    sample_size: components.sample_size_score || 0.6,
    supplier_specificity: components.supplier_specificity_score || 0.7,
    contradiction_level: components.contradiction_score || 1.0,
    historical_alignment: components.historical_alignment_score || 0.7
  };
};

const detectConflicts = (memory, signalAnalysis, intelligence) => {
  const conflicts = [];
  
  if (memory && memory.last_call_summary && !memory.last_call_summary.risk_flags) {
    if (intelligence && intelligence.rejectionPatterns && intelligence.rejectionPatterns.sample_size >= 20) {
      const rejectionRate = intelligence.rejectionPatterns.frequency || 0.3;
      if (rejectionRate > 0.4) {
        conflicts.push({
          type: "RISK_CONFLICT",
          description: "Supplier shows no risk history, but category has high rejection rate",
          severity: "Warning"
        });
      }
    }
  }
  
  if (memory && memory.trust_score !== undefined) {
    const sessionTrust = signalAnalysis.signal_patterns.responsiveness === "High" ? 7 : 5;
    const difference = Math.abs(sessionTrust - memory.trust_score);
    if (difference >= 2) {
      conflicts.push({
        type: "TRUST_CONFLICT",
        description: `Session signals differ from historical trust (difference: ${difference})`,
        severity: "Info"
      });
    }
  }
  
  return conflicts;
};

const resolveConflict = (conflict) => {
  switch(conflict.type) {
    case "RISK_CONFLICT":
      return "Use supplier's documented risk level; category is informational";
    case "TRUST_CONFLICT":
      return "Historical trust preserved; session assessment is advisory only";
    case "STAGE_CONFLICT":
      return "Use supplier's current stage; category pattern is informational";
    default:
      return "Use supplier-specific data; mark category as alternative";
  }
};

const buildConflictReport = (conflicts, intelligence) => {
  return {
    conflicts_detected: conflicts.length,
    conflicts: conflicts.map(c => ({
      type: c.type,
      severity: c.severity || "Info",
      description: c.description,
      resolution: resolveConflict(c)
    })),
    overall_assessment: conflicts.length === 0 ? "Conflict-free" : conflicts.length <= 1 ? "Minor conflicts" : "Significant conflicts",
    conflict_impact_on_confidence: Math.min(0.20, conflicts.length * 0.10)
  };
};

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 1 & 2: ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Vortex Supplier Intelligence Platform v14 - Active" });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2: Location 5 & 6 - /api/analyze-live with Intelligence Integration
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/analyze-live", async (req, res) => {
  try {
    // Input validation
    if (!req.body.companyName || !req.body.callType || !req.body.transcript) {
      return res.status(400).json({ error: "Missing required fields: companyName, callType, transcript" });
    }

    const { companyName, supplierId, callType, transcript, conversationHistory } = req.body;

    // ═══════════════════════════════════════════════════════════════════════════════
    // PHASE 2: Location 5 - Feature Flag & Load Time Budget Setup
    // ═══════════════════════════════════════════════════════════════════════════════

    const PHASE_2_ENABLED = 
      process.env.PHASE_2_ENABLED === 'true' || 
      process.env.PHASE_2_ENABLED === true;

    const PHASE_2_MAX_INTELLIGENCE_LOAD_TIME = 750;

    console.log({
      message: "Phase 2 Intelligence Engine Status",
      phase_2_enabled: PHASE_2_ENABLED,
      control_mechanism: "PHASE_2_ENABLED environment variable only"
    });

    const enrichmentStartTime = Date.now();

    // Phase 1: Find supplier
    let supplier = await findSupplier(companyName);
    const supplierFound = !!supplier;

    // Phase 1: Load memory if found
    let memory = null;
    if (supplierFound) {
      memory = await loadSupplierMemory(supplier.id);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // PHASE 2: Location 6 - Intelligence Load with Load Time Budget
    // ═══════════════════════════════════════════════════════════════════════════════

    let allIntelligence = {
      openQuestions: null,
      supplierBehaviorProfile: null,
      successPatterns: null,
      categoryIntel: null,
      rejectionPatterns: null,
      questionEffectiveness: null,
      openQuestionsForCategory: null
    };

    let intelligenceLoadStatus = {
      total_load_time_ms: 0,
      budget_ms: PHASE_2_MAX_INTELLIGENCE_LOAD_TIME,
      budget_exceeded: false,
      sources_loaded: 0,
      sources_skipped: 0,
      skipped_sources: [],
      budget_status: "Not started"
    };

    let budgetedIntelligence = null;

    if (PHASE_2_ENABLED && supplierFound) {
      try {
        const budgetTimer = Date.now();
        
        // Load all intelligence in parallel with timeout protection
        const loadPromises = {
          openQuestions: executeQueryWithTimeout(getOpenQuestions(supplier.id), 500),
          supplierBehaviorProfile: executeQueryWithTimeout(getSupplierBehaviorProfile(supplier.id), 500),
          successPatterns: executeQueryWithTimeout(getSuccessPatterns(supplier.category), 500),
          questionEffectiveness: executeQueryWithTimeout(getQuestionEffectiveness(supplier.id, supplier.category), 500),
          categoryIntel: executeQueryWithTimeout(getCategoryIntelligence(supplier.category), 500),
          rejectionPatterns: executeQueryWithTimeout(getRejectionPatterns(supplier.category), 500),
          openQuestionsForCategory: executeQueryWithTimeout(getOpenQuestionsForCategory(supplier.category), 500)
        };

        const results = await Promise.all(Object.values(loadPromises));
        const keys = Object.keys(loadPromises);
        
        keys.forEach((key, index) => {
          if (results[index]) {
            allIntelligence[key] = results[index];
          }
        });

        const totalLoadTime = Date.now() - budgetTimer;
        intelligenceLoadStatus.total_load_time_ms = totalLoadTime;
        intelligenceLoadStatus.sources_loaded = Object.values(allIntelligence).filter(x => x !== null).length;
        intelligenceLoadStatus.sources_skipped = Object.keys(allIntelligence).length - intelligenceLoadStatus.sources_loaded;
        intelligenceLoadStatus.skipped_sources = Object.keys(allIntelligence).filter(key => !allIntelligence[key]);

        if (totalLoadTime > PHASE_2_MAX_INTELLIGENCE_LOAD_TIME) {
          intelligenceLoadStatus.budget_exceeded = true;
          intelligenceLoadStatus.budget_status = `Exceeded (${totalLoadTime}ms > ${PHASE_2_MAX_INTELLIGENCE_LOAD_TIME}ms)`;
        } else {
          intelligenceLoadStatus.budget_status = `Completed in ${totalLoadTime}ms (${Math.round((totalLoadTime / PHASE_2_MAX_INTELLIGENCE_LOAD_TIME) * 100)}% of budget)`;
        }

        // Apply intelligence budget rule
        budgetedIntelligence = applyIntelligenceBudget(allIntelligence);

      } catch (error) {
        console.error("Error during intelligence load:", error);
        intelligenceLoadStatus.budget_exceeded = true;
        intelligenceLoadStatus.budget_status = "Error during load";
      }
    }

    // Phase 1: Extract signals and analyze
    const signalAnalysis = extractTranscriptSignals(transcript);
    const flowAnalysis = analyzeConversationFlow(conversationHistory);
    const collectedInfo = extractCollectedInfo(memory);
    const missingInfo = extractMissingInfo(memory, transcript);
    const riskFlags = extractRiskFlags(memory);

    // Phase 1 & 2: Combine insights
    const combinedRecommendation = combineInsights(
      memory,
      signalAnalysis,
      flowAnalysis,
      signalAnalysis.conversation_flow_stage,
      memory?.trust_score || 5,
      missingInfo,
      budgetedIntelligence?.intelligence_map
    );

    // Build intelligence sources attribution
    const intelligenceSources = buildIntelligenceSources(supplierFound, !!memory, budgetedIntelligence?.intelligence_map);

    // Build base response (Phase 1)
    let response = {
      schema_version: "1.0",
      supplier_found: supplierFound,
      supplier_id: supplier?.id || null,
      memory_based_insights: {
        current_stage: combinedRecommendation.current_assessment.stage,
        historical_trust_level: combinedRecommendation.current_assessment.historical_trust_level,
        previously_collected: collectedInfo,
        known_gaps: missingInfo,
        historical_risk_flags: riskFlags,
        known_objections: memory?.known_objections || [],
        known_restrictions: memory?.known_restrictions || []
      },
      message_based_insights: signalAnalysis,
      combined_recommendation: combinedRecommendation,
      intelligence_sources: intelligenceSources,
      timestamp: new Date().toISOString(),
      callType: callType
    };

    // Add Phase 2 fields if enabled and loaded
    if (PHASE_2_ENABLED && supplierFound && budgetedIntelligence) {
      
      // Calculate confidence
      let confidenceComponents = {
        freshness_score: 0.8,
        sample_size_score: 0.6,
        supplier_specificity_score: 0.7,
        contradiction_score: 1.0,
        historical_alignment_score: 0.7
      };

      if (budgetedIntelligence.intelligence_map.openQuestions) {
        const freshness = calculateDataFreshness(budgetedIntelligence.intelligence_map.openQuestions.updated_at);
        if (freshness) {
          confidenceComponents.freshness_score = freshness.freshness_tier === "Fresh" ? 1.0 : 
                                                freshness.freshness_tier === "Current" ? 1.0 :
                                                freshness.freshness_tier === "Recent" ? 0.95 : 0.75;
        }
      }

      if (budgetedIntelligence.intelligence_map.questionEffectiveness) {
        const sampleSize = budgetedIntelligence.intelligence_map.questionEffectiveness.count || 0;
        confidenceComponents.sample_size_score = sampleSize >= 100 ? 1.0 :
                                                sampleSize >= 50 ? 0.85 :
                                                sampleSize >= 20 ? 0.7 : 0.4;
      }

      if (budgetedIntelligence.intelligence_map.supplierBehaviorProfile) {
        confidenceComponents.supplier_specificity_score = 1.0;
      }

      const conflicts = detectConflicts(memory, signalAnalysis, budgetedIntelligence.intelligence_map);
      confidenceComponents.contradiction_score = calculateContradictionScore(conflicts, 5);

      const overall_confidence = calculateConfidenceScore(confidenceComponents);
      const confidence_tier = assignConfidenceTier(overall_confidence);
      const confidence_breakdown = buildConfidenceBreakdown(confidenceComponents);
      const conflictReport = buildConflictReport(conflicts, budgetedIntelligence.intelligence_map);

      response.intelligence_budget = {
        budget_limit: 5,
        active_sources_count: budgetedIntelligence.active_sources.length,
        active_sources: budgetedIntelligence.active_sources,
        informational_only_sources: budgetedIntelligence.informational_sources,
        budget_enforcement: "Top 5 sources influence recommendation, 3+ informational only"
      };

      response.intelligence_load_status = {
        total_load_time_ms: intelligenceLoadStatus.total_load_time_ms,
        budget_ms: intelligenceLoadStatus.budget_ms,
        budget_exceeded: intelligenceLoadStatus.budget_exceeded,
        sources_loaded: intelligenceLoadStatus.sources_loaded,
        sources_skipped: intelligenceLoadStatus.sources_skipped,
        skipped_sources: intelligenceLoadStatus.skipped_sources,
        budget_status: intelligenceLoadStatus.budget_status
      };

      response.recommendation_confidence = {
        overall_confidence: overall_confidence,
        confidence_tier: confidence_tier,
        confidence_breakdown: confidence_breakdown,
        action_ready: overall_confidence >= 0.60,
        note: overall_confidence >= 0.60 ? 
              "Confidence sufficient for decision" : 
              "Confidence below action threshold - gather more information"
      };

      response.intelligence_conflicts = conflictReport;
    }

    res.json(response);

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
      const supplier = await findSupplier(companyName);
      if (supplier) {
        supplierUuid = supplier.id;
        memory = await loadSupplierMemory(supplierUuid);
      }
    }

    const signalAnalysis = extractTranscriptSignals(supplierMessage);
    const missingInfo = extractMissingInfo(memory, supplierMessage);

    res.json({
      supplierUuid: supplierUuid,
      message_analysis: signalAnalysis,
      missing_information: missingInfo,
      signal_summary: `Responsiveness: ${signalAnalysis.signal_patterns.responsiveness}, Engagement: ${signalAnalysis.signal_patterns.engagement_indicators}`
    });

  } catch (error) {
    console.error("Error analyzing supplier message:", error);
    res.status(500).json({ error: "Failed to analyze message", details: error.message });
  }
});

app.post("/api/call-summary", async (req, res) => {
  try {
    const { supplierName, transcript, callNotes } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: "Transcript required" });
    }

    const signals = extractTranscriptSignals(transcript);
    const summary = {
      supplier_name: supplierName,
      transcript_length: transcript.length,
      key_signals: signals.signal_patterns,
      message_length: signals.context_metrics.message_length,
      engagement: signals.signal_patterns.engagement_indicators
    };

    res.json(summary);

  } catch (error) {
    console.error("Error generating call summary:", error);
    res.status(500).json({ error: "Failed to generate summary", details: error.message });
  }
});

app.get("/api/learning/questions", async (req, res) => {
  try {
    const { data } = await supabase
      .from("question_tracking")
      .select("*")
      .gte("effectiveness_score", 0.8)
      .order("effectiveness_score", { ascending: false })
      .limit(10);

    res.json({
      high_effectiveness_questions: data || [],
      count: data?.length || 0
    });

  } catch (error) {
    console.error("Error fetching learning questions:", error);
    res.status(500).json({ error: "Failed to fetch questions" });
  }
});

const PORT = process.env.PORT || 5678;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Phase 2 Intelligence Engine: ${process.env.PHASE_2_ENABLED === 'false' ? 'DISABLED' : 'ENABLED'}`);
});
