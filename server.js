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
  process.env.SUPABASE_URL || "https://rnptyphywrpjcfvklxsq.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "sb_secret_IgP7FnvaZxKvCnj50W-Cbg_1HWv-pe9"
);

const supplierMemory = new Map();

// ═══════════════════════════════════════
// SUPPLIER IDENTITY RESOLUTION
// ═══════════════════════════════════════

const normalizeSupplierName = (name) => {
  if (!name) return null;
  return name
    .toLowerCase()
    .replace(/\b(llc|inc|corp|co|ltd|company|inc\.|co\.|llc\.|distributor|dist|distribution|distributors)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

const findOrCreateSupplier = async (companyName, supplierId = null) => {
  const normalized = normalizeSupplierName(companyName);
  
  if (!normalized) return null;

  try {
    const { data: variantMatch } = await supabase
      .from("supplier_name_variants")
      .select("canonical_supplier_id")
      .eq("normalized_version", normalized)
      .gte("confidence", 90)
      .limit(1);

    if (variantMatch && variantMatch.length > 0) {
      return variantMatch[0].canonical_supplier_id;
    }

    const { data: exactMatch } = await supabase
      .from("supplier_memory")
      .select("id")
      .eq("company_name", companyName)
      .limit(1);

    if (exactMatch && exactMatch.length > 0) {
      return exactMatch[0].id;
    }

    const { data: newSupplier, error: createError } = await supabase
      .from("supplier_memory")
      .insert([{
        company_name: companyName,
        normalized_name: normalized,
        supplier_id: supplierId || null,
      }])
      .select()
      .single();

    if (createError) {
      console.error("Error creating supplier:", createError);
      return null;
    }

    await supabase
      .from("supplier_name_variants")
      .insert([{
        canonical_supplier_id: newSupplier.id,
        variant_name: companyName,
        normalized_version: normalized,
        confidence: 100
      }]);

    return newSupplier.id;
  } catch (error) {
    console.error("Identity resolution error:", error);
    return null;
  }
};

// ═══════════════════════════════════════
// PERSISTENT MEMORY FUNCTIONS
// ═══════════════════════════════════════

const loadSupplierMemory = async (supplierUuid) => {
  if (!supplierUuid) return null;

  try {
    if (supplierMemory.has(supplierUuid)) {
      return supplierMemory.get(supplierUuid);
    }

    const { data, error } = await supabase
      .from("supplier_memory")
      .select("*")
      .eq("id", supplierUuid)
      .single();

    if (error) return null;

    supplierMemory.set(supplierUuid, data);
    return data;
  } catch (error) {
    return null;
  }
};

const saveIncrementalMemory = async (supplierUuid, updates) => {
  if (!supplierUuid) return null;

  try {
    const { data, error } = await supabase
      .from("supplier_memory")
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq("id", supplierUuid)
      .select()
      .single();

    if (error) return null;

    supplierMemory.set(supplierUuid, data);
    return data;
  } catch (error) {
    return null;
  }
};

const updateSupplierMemoryFull = async (supplierUuid, updates) => {
  if (!supplierUuid) return null;

  try {
    const safeUpdates = { ...updates };
    
    if (updates.open_questions) {
      const current = await loadSupplierMemory(supplierUuid);
      if (current?.open_questions) {
        safeUpdates.open_questions = Array.from(
          new Set([...(current.open_questions || []), ...(updates.open_questions || [])])
        );
      }
    }

    if (updates.last_call_summary) {
      const current = await loadSupplierMemory(supplierUuid);
      const previous = [...(current?.previous_call_summaries || [])];
      previous.push(updates.last_call_summary);
      if (previous.length > 10) previous.shift();
      safeUpdates.previous_call_summaries = previous;
    }

    if (updates.trust_score !== undefined) {
      safeUpdates.trust_history = {
        timestamp: new Date().toISOString(),
        score: updates.trust_score,
        reason: updates.trust_reason || "Score updated"
      };
    }

    if (updates.call_type && updates.call_summary) {
      const current = await loadSupplierMemory(supplierUuid);
      const history = current?.interaction_history || [];
      history.push({
        date: new Date().toISOString().split('T')[0],
        call_type: updates.call_type,
        summary: updates.call_summary,
        timestamp: new Date().toISOString()
      });
      safeUpdates.interaction_history = history;
    }

    safeUpdates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("supplier_memory")
      .update(safeUpdates)
      .eq("id", supplierUuid)
      .select()
      .single();

    if (error) return null;

    supplierMemory.set(supplierUuid, data);
    return data;
  } catch (error) {
    return null;
  }
};

// ═══════════════════════════════════════
// LEARNING INTELLIGENCE ENGINE
// ═══════════════════════════════════════

const getConfidenceTier = (sampleSize) => {
  if (sampleSize < 10) return 'Experimental';
  if (sampleSize < 20) return 'Emerging Pattern';
  if (sampleSize < 50) return 'Validated Pattern';
  if (sampleSize < 100) return 'Strong Pattern';
  return 'Proven Pattern';
};

const isConfidenceHighEnough = (sampleSize) => {
  return sampleSize >= 20;
};

const extractSupplierCategory = (memory, transcript) => {
  if (memory?.supplier_category) return memory.supplier_category;
  
  const categories = ['Beauty', 'Personal Care', 'Electronics', 'Home Goods', 'Pet', 'Health', 'Sports', 'Food', 'Supplements', 'Apparel'];
  const nameUpper = memory?.company_name?.toUpperCase() || '';
  
  for (const cat of categories) {
    if (nameUpper.includes(cat.toUpperCase())) return cat;
  }
  
  return 'Uncategorized';
};

const updateCategoryIntelligence = async (category, callOutcome) => {
  const { data: existing } = await supabase
    .from('category_intelligence')
    .select('*')
    .eq('category', category)
    .single();

  const current = existing || {
    category,
    total_calls: 0,
    approval_rate: 0,
    rejection_rate: 0,
    most_common_objections: [],
    most_common_restrictions: [],
    avg_trust_growth: 0,
    sample_size: 0,
    recent_call_count: 0,
    historical_call_count: 0
  };

  const updates = {
    total_calls: current.total_calls + 1,
    sample_size: current.sample_size + 1,
    recent_call_count: (current.recent_call_count || 0) + 1,
    updated_at: new Date().toISOString(),
    last_seen: new Date().toISOString()
  };

  if (callOutcome.mission_complete || callOutcome.is_fit_for_account === 'yes') {
    updates.approval_rate = (current.approval_rate * current.total_calls + 1) / (current.total_calls + 1);
  } else if (callOutcome.is_fit_for_account === 'no') {
    updates.rejection_rate = (current.rejection_rate * current.total_calls + 1) / (current.total_calls + 1);
  }

  if (callOutcome.known_objections && callOutcome.known_objections.length > 0) {
    const objections = current.most_common_objections || [];
    callOutcome.known_objections.forEach(obj => {
      const found = objections.find(o => o.text === obj);
      if (found) {
        found.count = (found.count || 1) + 1;
      } else {
        objections.push({ text: obj, count: 1 });
      }
    });
    updates.most_common_objections = objections
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, 10);
  }

  if (callOutcome.red_flags && callOutcome.red_flags.length > 0) {
    const restrictions = current.most_common_restrictions || [];
    callOutcome.red_flags.forEach(flag => {
      const found = restrictions.find(r => r.text === flag);
      if (found) {
        found.count = (found.count || 1) + 1;
      } else {
        restrictions.push({ text: flag, count: 1 });
      }
    });
    updates.most_common_restrictions = restrictions
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, 10);
  }

  updates.confidence_level = getConfidenceTier(updates.sample_size);
  updates.first_seen = existing?.first_seen || new Date().toISOString();
  updates.decay_factor = calculatePatternDecay(updates.last_seen, updates.first_seen);

  const { error } = existing
    ? await supabase
        .from('category_intelligence')
        .update(updates)
        .eq('category', category)
    : await supabase
        .from('category_intelligence')
        .insert([{ ...current, ...updates }]);

  if (error) {
    console.error('Error updating category intelligence:', error);
  }
};

const recordRejection = async (category, rejectionReason, stage, callType, triggerEvent) => {
  const { data: existing } = await supabase
    .from('rejection_intelligence')
    .select('*')
    .eq('supplier_category', category)
    .eq('rejection_reason', rejectionReason)
    .eq('stage_when_rejected', stage)
    .single();

  const updates = {
    frequency_count: (existing?.frequency_count || 0) + 1,
    updated_at: new Date().toISOString()
  };

  updates.confidence_level = getConfidenceTier(updates.frequency_count);

  const { error } = existing
    ? await supabase
        .from('rejection_intelligence')
        .update(updates)
        .eq('id', existing.id)
    : await supabase
        .from('rejection_intelligence')
        .insert([{
          supplier_category: category,
          rejection_reason: rejectionReason,
          stage_when_rejected: stage,
          call_type: callType,
          trigger_event: triggerEvent,
          frequency_count: 1,
          confidence_level: 0
        }]);

  if (error) {
    console.error('Error recording rejection:', error);
  }
};

const recordSuccessProgression = async (category, fromStage, toStage, questionsUsed, objectionsOvercome, trustChange) => {
  const { data: existing } = await supabase
    .from('success_intelligence')
    .select('*')
    .eq('supplier_category', category)
    .eq('from_stage', fromStage)
    .eq('to_stage', toStage)
    .single();

  const current = existing || {
    supplier_category: category,
    from_stage: fromStage,
    to_stage: toStage,
    frequency_count: 0,
    avg_trust_change: 0
  };

  const updates = {
    frequency_count: current.frequency_count + 1,
    questions_used: questionsUsed || [],
    objections_overcome: objectionsOvercome || [],
    avg_trust_change: (current.avg_trust_change * current.frequency_count + trustChange) / (current.frequency_count + 1),
    updated_at: new Date().toISOString()
  };

  updates.confidence_level = getConfidenceTier(updates.frequency_count);

  const { error } = existing
    ? await supabase
        .from('success_intelligence')
        .update(updates)
        .eq('id', existing.id)
    : await supabase
        .from('success_intelligence')
        .insert([{ ...current, ...updates }]);

  if (error) {
    console.error('Error recording success:', error);
  }
};

const updateSupplierBehaviorProfile = async (supplierId, behaviorData) => {
  const { data: existing } = await supabase
    .from('supplier_behavior_profile')
    .select('*')
    .eq('supplier_id', supplierId)
    .single();

  const updates = {
    ...behaviorData,
    calls_analyzed: (existing?.calls_analyzed || 0) + 1,
    updated_at: new Date().toISOString()
  };

  const { error } = existing
    ? await supabase
        .from('supplier_behavior_profile')
        .update(updates)
        .eq('supplier_id', supplierId)
    : await supabase
        .from('supplier_behavior_profile')
        .insert([{ supplier_id: supplierId, ...updates }]);

  if (error) {
    console.error('Error updating behavior profile:', error);
  }
};

const getStrategyContext = async (supplierId, category) => {
  let strategyCues = '';

  if (!category || category === 'Uncategorized') {
    return strategyCues;
  }

  try {
    const { data: catIntel } = await supabase
      .from('category_intelligence')
      .select('*')
      .eq('category', category)
      .single();

    if (catIntel && isConfidenceHighEnough(catIntel.sample_size)) {
      strategyCues += `
CATEGORY INTELLIGENCE (${catIntel.confidence_level}):
- Approval Rate: ${(catIntel.approval_rate * 100).toFixed(0)}%
- Common Objections: ${catIntel.most_common_objections?.slice(0, 3).map(o => o.text).join(', ') || 'None'}
- Common Restrictions: ${catIntel.most_common_restrictions?.slice(0, 3).map(r => r.text).join(', ') || 'None'}
`;
    }

    const { data: rejections } = await supabase
      .from('rejection_intelligence')
      .select('*')
      .eq('supplier_category', category)
      .order('frequency_count', { ascending: false })
      .limit(3);

    if (rejections && rejections.length > 0) {
      const validatedRejections = rejections.filter(r => isConfidenceHighEnough(r.frequency_count));
      if (validatedRejections.length > 0) {
        strategyCues += `
REJECTION PATTERNS (${category}):
${validatedRejections.map(r => `- ${r.rejection_reason} (at ${r.stage_when_rejected})`).join('\n')}
`;
      }
    }

    const { data: successes } = await supabase
      .from('success_intelligence')
      .select('*')
      .eq('supplier_category', category)
      .order('frequency_count', { ascending: false })
      .limit(3);

    if (successes && successes.length > 0) {
      const validatedSuccesses = successes.filter(s => isConfidenceHighEnough(s.frequency_count));
      if (validatedSuccesses.length > 0) {
        strategyCues += `
SUCCESS PATTERNS (${category}):
${validatedSuccesses.map(s => `- Progression to ${s.to_stage} (Trust +${s.avg_trust_change.toFixed(1)})`).join('\n')}
`;
      }
    }

    if (supplierId) {
      const { data: profile } = await supabase
        .from('supplier_behavior_profile')
        .select('*')
        .eq('supplier_id', supplierId)
        .single();

      if (profile) {
        strategyCues += `
SUPPLIER PROFILE:
- Type: ${profile.personality_type || 'Unknown'}
- Style: ${profile.communication_style || 'Unknown'}
- Approval Probability: ${(profile.approval_probability * 100).toFixed(0)}%
`;
      }
    }
  } catch (error) {
    console.error('Error loading strategy context:', error);
  }

  return strategyCues;
};

const updateLearningIntelligence = async (supplierId, companyName, callOutcome, callType, memory) => {
  try {
    const category = extractSupplierCategory(memory, '');
    
    await updateCategoryIntelligence(category, callOutcome);

    if (callOutcome.is_fit_for_account === 'no') {
      const rejectionReason = callOutcome.red_flags?.[0] || 'Unknown';
      const stage = memory?.relationship_stage || 'Prospect';
      await recordRejection(category, rejectionReason, stage, callType, '');
    }

    if (callOutcome.recommended_relationship_stage && memory?.relationship_stage) {
      if (callOutcome.recommended_relationship_stage !== memory.relationship_stage) {
        const trustChange = callOutcome.recommended_trust_score_adjustment || 0;
        await recordSuccessProgression(
          category,
          memory.relationship_stage,
          callOutcome.recommended_relationship_stage,
          [],
          callOutcome.known_objections || [],
          trustChange
        );
      }
    }

    if (supplierId) {
      await updateSupplierBehaviorProfile(supplierId, {
        personality_type: callOutcome.supplier_personality,
        communication_style: callOutcome.communication_style,
        positive_signals: callOutcome.positive_signals || [],
        negative_signals: callOutcome.known_objections || [],
        approval_probability: callOutcome.recommended_relationship_stage === 'Approved' ? 0.9 : 0.5
      });
    }
  } catch (error) {
    console.error('Error updating learning intelligence:', error);
  }
};

// ═══════════════════════════════════════
// V14 LEARNING ENGINE UPGRADES
// ═══════════════════════════════════════

// UPGRADE #1: Record Individual Question Usage
const recordQuestionUsage = async (question, responseLength, engagementChange, trustChange, relationshipProgression, resistanceTriggered) => {
  const { data: existing } = await supabase
    .from('question_tracking')
    .select('*')
    .eq('question_text', question)
    .single();

  const current = existing || {
    question_text: question,
    times_used: 0,
    avg_response_length: 0,
    engagement_change: 0,
    trust_change: 0,
    relationship_progression: 0,
    resistance_triggered_count: 0,
    sample_size: 0,
    recent_call_count: 0
  };

  const updates = {
    times_used: current.times_used + 1,
    sample_size: current.sample_size + 1,
    recent_call_count: (current.recent_call_count || 0) + 1,
    avg_response_length: (current.avg_response_length * current.times_used + responseLength) / (current.times_used + 1),
    engagement_change: (current.engagement_change * current.times_used + engagementChange) / (current.times_used + 1),
    trust_change: (current.trust_change * current.times_used + trustChange) / (current.times_used + 1),
    relationship_progression: (current.relationship_progression * current.times_used + relationshipProgression) / (current.times_used + 1),
    updated_at: new Date().toISOString(),
    last_seen: new Date().toISOString()
  };

  if (resistanceTriggered) {
    updates.resistance_triggered_count = current.resistance_triggered_count + 1;
  }

  const responseQuality = Math.min(responseLength / 200, 1);
  const trustImpact = Math.max(-1, Math.min(1, trustChange / 2));
  const progressionImpact = Math.max(-1, Math.min(1, relationshipProgression / 5));
  const resistanceImpact = resistanceTriggered ? -0.3 : 0;

  updates.effectiveness_score = (responseQuality * 0.3 + trustImpact * 0.35 + progressionImpact * 0.25 + resistanceImpact * 0.1);
  updates.confidence_level = getConfidenceTier(updates.sample_size);
  updates.first_seen = existing?.first_seen || new Date().toISOString();

  const { error } = existing
    ? await supabase
        .from('question_tracking')
        .update(updates)
        .eq('id', existing.id)
    : await supabase
        .from('question_tracking')
        .insert([{ ...current, ...updates }]);

  if (error) {
    console.error('Error recording question:', error);
  }
};

// UPGRADE #2: Extract Category Hierarchy
const extractCategoryHierarchy = async (supplierId, companyName, transcript, callSummary) => {
  const categoryHierarchies = {
    'Beauty': {
      subcategories: ['Skincare', 'Makeup', 'Haircare', 'Fragrance'],
      keywords: ['makeup', 'cosmetics', 'skincare', 'moisturizer', 'serum', 'lipstick', 'foundation', 'shampoo', 'conditioner', 'perfume']
    },
    'Personal Care': {
      subcategories: ['Oral', 'Bath', 'Deodorant', 'Grooming'],
      keywords: ['toothpaste', 'soap', 'deodorant', 'lotion', 'shaving', 'grooming', 'razor']
    },
    'Health': {
      subcategories: ['Supplements', 'Vitamins', 'Wellness', 'Medical'],
      keywords: ['supplement', 'vitamin', 'health', 'wellness', 'medical', 'collagen', 'fish oil']
    },
    'Electronics': {
      subcategories: ['Mobile', 'Computing', 'Wearables', 'Accessories'],
      keywords: ['phone', 'laptop', 'tablet', 'computer', 'watch', 'charger', 'cable']
    },
    'Pet': {
      subcategories: ['Pet Food', 'Pet Care', 'Pet Toys', 'Pet Health'],
      keywords: ['pet', 'dog', 'cat', 'animal', 'pet food', 'pet care', 'paw']
    },
    'Sports': {
      subcategories: ['Apparel', 'Equipment', 'Footwear', 'Accessories'],
      keywords: ['sport', 'athletic', 'fitness', 'gym', 'exercise', 'shoe', 'jersey']
    },
    'Food': {
      subcategories: ['Beverages', 'Snacks', 'Condiments', 'Specialty'],
      keywords: ['food', 'beverage', 'drink', 'snack', 'edible', 'coffee', 'tea']
    },
    'Home Goods': {
      subcategories: ['Furniture', 'Kitchen', 'Decor', 'Storage'],
      keywords: ['home', 'household', 'furniture', 'decor', 'kitchen', 'storage']
    }
  };

  const transcriptLower = transcript?.toLowerCase() || '';
  const summaryLower = JSON.stringify(callSummary || {}).toLowerCase();
  const nameUpper = companyName?.toUpperCase() || '';
  const allText = `${transcriptLower} ${summaryLower}`;

  let primaryCategory = null;
  let subcategory = null;
  const detectedProducts = [];
  const scores = {};

  Object.entries(categoryHierarchies).forEach(([category, data]) => {
    scores[category] = 0;
    data.keywords.forEach(keyword => {
      if (allText.includes(keyword)) {
        scores[category] += 2;
        detectedProducts.push(keyword);
      }
    });
    if (nameUpper.includes(category.toUpperCase())) {
      scores[category] += 5;
    }
  });

  let maxScore = 0;
  Object.entries(scores).forEach(([cat, score]) => {
    if (score > maxScore) {
      maxScore = score;
      primaryCategory = cat;
    }
  });

  if (primaryCategory && categoryHierarchies[primaryCategory]) {
    const subData = categoryHierarchies[primaryCategory];
    const subScores = {};
    subData.subcategories.forEach(sub => {
      subScores[sub] = 0;
      sub.toLowerCase().split(' ').forEach(word => {
        if (allText.includes(word)) {
          subScores[sub] += 1;
        }
      });
    });

    let maxSubScore = 0;
    Object.entries(subScores).forEach(([sub, score]) => {
      if (score > maxSubScore) {
        maxSubScore = score;
        subcategory = sub;
      }
    });
  }

  if (!primaryCategory) {
    primaryCategory = 'Uncategorized';
  }

  const { data: cached } = await supabase
    .from('supplier_category_cache')
    .select('*')
    .eq('supplier_id', supplierId)
    .single();

  const updates = {
    primary_category: primaryCategory,
    subcategory: subcategory || 'General',
    products: Array.from(new Set(detectedProducts)).slice(0, 10),
    detected_category: primaryCategory,
    confidence: Math.min(100, maxScore * 10),
    last_detected: new Date().toISOString()
  };

  const { error } = cached
    ? await supabase
        .from('supplier_category_cache')
        .update(updates)
        .eq('supplier_id', supplierId)
    : await supabase
        .from('supplier_category_cache')
        .insert([{ supplier_id: supplierId, ...updates }]);

  if (error) {
    console.error('Error caching category hierarchy:', error);
  }

  return { primary: primaryCategory, sub: subcategory, products: detectedProducts };
};

// UPGRADE #3: Apply Recency Weighting
const applyRecencyWeighting = (recentValue, historicalValue, recentWeight = 0.4, historicalWeight = 0.6) => {
  return (recentValue * recentWeight) + (historicalValue * historicalWeight);
};

// UPGRADE #4: Calculate Pattern Decay
const calculatePatternDecay = (lastSeen, firstSeen) => {
  if (!lastSeen || !firstSeen) return 1.0;

  const now = new Date();
  const lastSeenDate = new Date(lastSeen);
  const firstSeenDate = new Date(firstSeen);
  
  const daysSinceLastSeen = (now - lastSeenDate) / (1000 * 60 * 60 * 24);
  const totalDays = (lastSeenDate - firstSeenDate) / (1000 * 60 * 60 * 24);

  const decayFactor = Math.pow(0.95, daysSinceLastSeen / 7);
  
  return Math.max(0.5, decayFactor);
};

// UPGRADE #5: Calculate Playbook Pattern Confidence
const calculatePlaybookPatternConfidence = (pattern, sample_size) => {
  if (!sample_size) return 0;
  if (sample_size < 2) return 0.1;
  if (sample_size < 5) return 0.3;
  if (sample_size < 10) return 0.6;
  if (sample_size < 20) return 0.8;
  return 1.0;
};

const updatePlaybookWithConfidence = async (supplierId, playbookData) => {
  const { data: existing } = await supabase
    .from('supplier_playbook')
    .select('*')
    .eq('supplier_id', supplierId)
    .single();

  const updates = {
    ...playbookData,
    calls_analyzed: (existing?.calls_analyzed || 0) + 1,
    updated_at: new Date().toISOString()
  };

  const patternConfidence = {};

  if (playbookData.communication_style) {
    patternConfidence.communication_style = calculatePlaybookPatternConfidence('communication_style', updates.calls_analyzed);
  }

  if (playbookData.best_performing_approaches && Array.isArray(playbookData.best_performing_approaches)) {
    patternConfidence.best_performing_approaches = calculatePlaybookPatternConfidence('approaches', updates.calls_analyzed);
  }

  if (playbookData.topics_positive_response && Array.isArray(playbookData.topics_positive_response)) {
    patternConfidence.topics_positive_response = calculatePlaybookPatternConfidence('topics_positive', updates.calls_analyzed);
  }

  if (playbookData.topics_negative_response && Array.isArray(playbookData.topics_negative_response)) {
    patternConfidence.topics_negative_response = calculatePlaybookPatternConfidence('topics_negative', updates.calls_analyzed);
  }

  updates.pattern_confidence = patternConfidence;
  updates.playbook_quality_score = Object.values(patternConfidence).reduce((a, b) => a + b, 0) / Object.keys(patternConfidence).length;

  if (playbookData.best_performing_approaches && existing?.best_performing_approaches) {
    updates.best_performing_approaches = Array.from(
      new Set([...existing.best_performing_approaches, ...playbookData.best_performing_approaches])
    );
  }

  if (playbookData.topics_positive_response && existing?.topics_positive_response) {
    updates.topics_positive_response = Array.from(
      new Set([...existing.topics_positive_response, ...playbookData.topics_positive_response])
    );
  }

  if (playbookData.topics_negative_response && existing?.topics_negative_response) {
    updates.topics_negative_response = Array.from(
      new Set([...existing.topics_negative_response, ...playbookData.topics_negative_response])
    );
  }

  const { error } = existing
    ? await supabase
        .from('supplier_playbook')
        .update(updates)
        .eq('supplier_id', supplierId)
    : await supabase
        .from('supplier_playbook')
        .insert([{ supplier_id: supplierId, ...updates }]);

  if (error) {
    console.error('Error updating playbook with confidence:', error);
    return null;
  }

  return updates;
};

// UPGRADE #6: Calculate Dynamic Approval Probability
const calculateDynamicApprovalProbability = async (supplierId, memory, profile) => {
  if (!memory || !profile) return 0.5;

  const factors = {};

  factors.trust_score_factor = (memory.trust_score || 5) / 10 * 0.25;

  const stageScores = {
    'Prospect': 0.05,
    'Contact': 0.10,
    'Interested': 0.15,
    'Approved': 1.0,
    'Active': 1.0,
    'Preferred': 1.0,
    'Strategic': 1.0
  };
  factors.stage_factor = (stageScores[memory.relationship_stage] || 0.05) * 0.25;

  const positiveSignalCount = (profile.positive_signals || []).length;
  factors.signal_factor = Math.min(positiveSignalCount / 5, 1) * 0.25;

  const negativeSignalCount = (profile.negative_signals || []).length;
  factors.objection_factor = Math.max(0, (1 - (negativeSignalCount / 10))) * 0.15;

  const callCount = memory.interaction_history?.length || 0;
  const successfulCalls = (memory.previous_call_summaries || []).filter(c => c.overall_score >= 7).length;
  factors.historical_factor = (callCount > 0 ? successfulCalls / callCount : 0.5) * 0.10;

  const totalProbability = Object.values(factors).reduce((a, b) => a + b, 0);

  return {
    probability: Math.min(1.0, totalProbability),
    factors: factors,
    breakdown: {
      trust_score: (memory.trust_score || 5) / 10,
      relationship_stage: memory.relationship_stage,
      positive_signals: positiveSignalCount,
      negative_signals: negativeSignalCount,
      successful_call_rate: callCount > 0 ? successfulCalls / callCount : 0
    }
  };
};

const updateBehaviorProfileWithDynamicProbability = async (supplierId, behaviorData, memory) => {
  const { data: existing } = await supabase
    .from('supplier_behavior_profile')
    .select('*')
    .eq('supplier_id', supplierId)
    .single();

  const approvalModel = await calculateDynamicApprovalProbability(supplierId, memory, behaviorData);

  const updates = {
    ...behaviorData,
    approval_probability: approvalModel.probability,
    approval_probability_model: approvalModel,
    calls_analyzed: (existing?.calls_analyzed || 0) + 1,
    updated_at: new Date().toISOString()
  };

  const { error } = existing
    ? await supabase
        .from('supplier_behavior_profile')
        .update(updates)
        .eq('supplier_id', supplierId)
    : await supabase
        .from('supplier_behavior_profile')
        .insert([{ supplier_id: supplierId, ...updates }]);

  if (error) {
    console.error('Error updating behavior profile:', error);
    return null;
  }

  return updates;
};

// Get weighted category intelligence
const getWeightedCategoryIntelligence = async (category) => {
  const { data } = await supabase
    .from('category_intelligence')
    .select('*')
    .eq('category', category)
    .single();

  if (!data) return null;

  const decay = calculatePatternDecay(data.last_seen, data.first_seen);
  const recentCallRate = data.recent_call_count ? data.recent_call_count / (data.recent_call_count + data.historical_call_count) : 0.5;
  const weightedApprovalRate = applyRecencyWeighting(
    recentCallRate,
    data.approval_rate || 0.5,
    0.4,
    0.6
  );

  return {
    ...data,
    effective_approval_rate: weightedApprovalRate * decay,
    decay_factor: decay,
    recency_score: recentCallRate
  };
};

// Get weighted opening/closing
const getWeightedOpeningClosing = async (statementType) => {
  const { data } = await supabase
    .from('opening_closing_effectiveness')
    .select('*')
    .eq('statement_type', statementType)
    .gte('sample_size', 5)
    .order('effectiveness_score', { ascending: false })
    .limit(10);

  if (!data || data.length === 0) return [];

  return data.map(statement => {
    const decay = calculatePatternDecay(statement.last_seen, statement.first_seen);
    const recentRate = statement.recent_call_count ? statement.recent_call_count / (statement.recent_call_count + statement.historical_call_count) : 0.5;
    
    return {
      ...statement,
      effective_score: statement.effectiveness_score * decay,
      decay_factor: decay,
      recency_score: recentRate
    };
  });
};

// ═══════════════════════════════════════
// VORTEX CONFIGURATION
// ═══════════════════════════════════════

const VORTEX_PROFILE = `
=== VORTEX ORIGIN BRANDS LLC ===
Company: Vortex Origin Brands, Wyoming-based wholesale company
Founder: Sanaullah
Business: Wholesale Buyer & Supplier Partnerships

CRITICAL: Always position as a WHOLESALE BUYER with real purchasing power.
Never as: consultant, agency, service provider.
`;

const TRUTH_RULE = `
TRUTH RULE (FOUNDATION - OVERRIDES ALL OTHER RULES)

Never instruct Sanaullah to provide false information.
If asked about Amazon/marketplaces: Answer truthfully. ALWAYS.
Trust preservation is more important than account approval.
`;

const DISTRIBUTOR_INQUIRY_SYSTEM = `
YOU ARE: Distributor Account Opening Coach for Vortex Origin Brands.

PRIMARY OBJECTIVE: Open and qualify a wholesale distributor account.

QUESTION PRIORITY: 
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

AUTO-CHECK RULE: When information is collected, automatically mark it complete.
RED FLAGS (PAUSE): Amazon/marketplace restrictions, Exclusivity, Geographic restrictions

LANGUAGE: Natural, professional, confident about Vortex, transparent about concerns.
`;

const RETAIL_INQUIRY_SYSTEM = `
YOU ARE: Retail Partnership Discovery Coach for Vortex Origin Brands.

PRIMARY OBJECTIVE: Determine if open to wholesale partnerships.

DISCOVERY PRIORITY:
1. Open to wholesale accounts?
2. Who handles partnerships?
3. Approval process?
4. Documents required?
5. Distribution restrictions?
6. Marketplace restrictions?
7. MAP policy?
8. Next step?

ANTI-INTERROGATION: One discovery point per response. Conversational. Natural.
RED FLAGS (PAUSE): No Amazon sellers, Exclusivity, Territory restrictions
`;

const CALL_INSTRUCTIONS = {
  distributor_inquiry: DISTRIBUTOR_INQUIRY_SYSTEM,
  quick_note: `TARGET: Brand open to wholesale. GOAL: Confirm interest.`,
  brand_registry: `TARGET: Unprotected Amazon brand. GOAL: Position as wholesale + Amazon manager.`,
  retail_inquiry: RETAIL_INQUIRY_SYSTEM
};

const formatMemoryForPrompt = (memory) => {
  if (!memory) return "No supplier memory found.";
  
  return `
SUPPLIER MEMORY:

Supplier: ${memory.company_name || memory.supplier_id}
Category: ${memory.supplier_category || 'Uncategorized'}
Stage: ${memory.relationship_stage}
Trust Score: ${memory.trust_score}/10
Last Contact: ${memory.last_contact_date || 'Never'}

KNOWN: ${Object.entries({
  'MOQ': memory.MOQ,
  'Payment Terms': memory.payment_terms,
  'Approval Timeline': memory.approval_timeline,
  'Ordering Process': memory.ordering_process,
  'Freight Terms': memory.freight_terms,
  'Marketplace Policy': memory.marketplace_policy,
  'MAP Policy': memory.MAP_policy,
  'Volume Discounts': memory.volume_discount_structure
}).filter(([_, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' | ') || 'None yet'}

CONCERNS: ${memory.known_objections?.join(', ') || 'None'}
RESTRICTIONS: ${memory.known_restrictions?.join(', ') || 'None'}
OPEN QUESTIONS: ${memory.open_questions?.join(', ') || 'None'}
`;
};

const formatPlaybookForPrompt = (playbook) => {
  if (!playbook) return '';

  const getConfidenceLabel = (score) => {
    if (!score) return 'Experimental';
    if (score < 0.3) return 'Experimental';
    if (score < 0.6) return 'Emerging';
    if (score < 0.8) return 'Validated';
    if (score < 1.0) return 'Strong';
    return 'Proven';
  };

  const patternConf = playbook.pattern_confidence || {};

  return `
SUPPLIER PLAYBOOK (Quality: ${(playbook.playbook_quality_score * 100 || 0).toFixed(0)}%):

Style: ${playbook.communication_style || 'Unknown'} (${getConfidenceLabel(patternConf.communication_style)})
Best Approaches: ${playbook.best_performing_approaches?.slice(0, 3).join(', ') || 'None yet'}
Positive Topics: ${playbook.topics_positive_response?.slice(0, 3).join(', ') || 'Unknown'}
Negative Topics: ${playbook.topics_negative_response?.slice(0, 3).join(', ') || 'None'}
`;
};

// ═══════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Vortex Live Call Copilot v14 - Learning Engine Upgraded" });
});

app.post("/api/analyze-live", async (req, res) => {
  try {
    const { transcript, conversationHistory, brief, callType, supplierId, companyName } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: "Transcript required" });
    }

    let memory = null;
    let supplierUuid = null;

    if (supplierId || companyName) {
      supplierUuid = await findOrCreateSupplier(companyName, supplierId);
      
      if (supplierUuid) {
        memory = await loadSupplierMemory(supplierUuid);
      }
    }

    const memoryContext = memory ? formatMemoryForPrompt(memory) : "";

    const supplierCategory = memory ? extractSupplierCategory(memory, '') : null;
    
    let strategyContext = '';
    if (supplierUuid && supplierCategory && supplierCategory !== 'Uncategorized') {
      const weightedCatIntel = await getWeightedCategoryIntelligence(supplierCategory);
      
      if (weightedCatIntel && isConfidenceHighEnough(weightedCatIntel.sample_size)) {
        strategyContext += `
CATEGORY INTELLIGENCE (${weightedCatIntel.confidence_level}, Decay: ${weightedCatIntel.decay_factor.toFixed(2)}):
- Approval Rate: ${(weightedCatIntel.effective_approval_rate * 100).toFixed(0)}%
- Common Objections: ${weightedCatIntel.most_common_objections?.slice(0, 3).map(o => o.text).join(', ') || 'None'}
`;
      }

      const weightedOpenings = await getWeightedOpeningClosing('opening');
      if (weightedOpenings.length > 0) {
        strategyContext += `
HIGH-PERFORMING OPENINGS:
${weightedOpenings.slice(0, 3).map(o => `- "${o.statement_text.substring(0, 50)}..." (${(o.effective_score * 100).toFixed(0)}%)`).join('\n')}
`;
      }
    }

    const playbook = supplierUuid ? await supabase
      .from('supplier_playbook')
      .select('*')
      .eq('supplier_id', supplierUuid)
      .single()
      .then(r => r.data) : null;
    
    const playbookContext = playbook ? formatPlaybookForPrompt(playbook) : '';

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
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `${memoryContext}

${playbookContext}

${strategyContext}

${TRUTH_RULE}

${VORTEX_PROFILE}

${instruction}

${context}Contact just said: "${transcript}"

You are Sanaullah's live call copilot. Tell him what to say next.

RULES:
1. TRUTH RULE OVERRIDES ALL
2. Don't ask already-collected info
3. Pause for red flags
4. Close when mission complete
5. Be natural and personalized

OUTPUT ONLY:

SAY NOW:
[Exact words only]`
        }
      ]
    });

    const responseText = message.content[0].type === "text" ? message.content[0].text : "";
    const sayNowMatch = responseText.match(/SAY NOW:\n([\s\S]*?)(?:\n\n|$)/);
    const guidance = sayNowMatch ? sayNowMatch[1].trim() : responseText;

    res.json({ 
      guidance,
      timestamp: new Date().toISOString(),
      callType: callType,
      supplierId: supplierUuid
    });
  } catch (error) {
    console.error("Claude API error:", error);
    res.status(500).json({ error: "Failed to generate response", details: error.message });
  }
});

app.post("/api/call-summary", async (req, res) => {
  try {
    const { conversationHistory, brief, callType, callDuration, supplierId, companyName } = req.body;

    if (!conversationHistory || conversationHistory.length === 0) {
      return res.status(400).json({ error: "Conversation history required" });
    }

    let transcript = "";
    conversationHistory.forEach(item => {
      transcript += `${item.speaker === 'contact' ? 'CONTACT' : 'YOU'}: ${item.text}\n\n`;
    });

    const analysisPrompt = `
Analyze this ${callType} call. Return ONLY JSON.

${transcript}

${callType === 'retail_inquiry' ? `
{
  "call_type": "retail_inquiry",
  "wholesale_opportunity": "yes/no/unclear",
  "decision_maker_identified": true/false,
  "documents_required": "string or null",
  "marketplace_policy": "string or null",
  "supplier_personality": "string or null",
  "communication_style": "string or null",
  "supplier_priorities": ["array"],
  "supplier_concerns": ["array"],
  "known_objections": ["array"],
  "known_restrictions": ["array"],
  "positive_signals": ["array"],
  "opening_statement": "string or null",
  "closing_statement": "string or null",
  "next_natural_conversation": "string or null",
  "relationship_summary": "string or null",
  "recommended_relationship_stage": "string",
  "recommended_trust_score_adjustment": -2 to 2,
  "is_fit_for_account": "yes/no/conditional",
  "red_flags": [],
  "overall_score": 0-10
}
` : `
{
  "call_type": "distributor_inquiry",
  "mission_complete": true/false,
  "moq": "string or null",
  "payment_terms": "string or null",
  "approval_timeline": "string or null",
  "documents_required": "string or null",
  "supplier_personality": "string or null",
  "communication_style": "string or null",
  "supplier_priorities": ["array"],
  "supplier_concerns": ["array"],
  "known_objections": ["array"],
  "known_restrictions": ["array"],
  "positive_signals": ["array"],
  "opening_statement": "string or null",
  "closing_statement": "string or null",
  "next_natural_conversation": "string or null",
  "relationship_summary": "string or null",
  "recommended_relationship_stage": "string",
  "recommended_trust_score_adjustment": -2 to 2,
  "is_fit_for_account": "yes/no/conditional",
  "red_flags": [],
  "product_categories": ["array"],
  "overall_score": 0-10
}
`}`;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
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

    if (supplierId || companyName) {
      const supplierUuid = await findOrCreateSupplier(companyName, supplierId);
      
      if (supplierUuid) {
        const memoryUpdates = {
          relationship_summary: summary.relationship_summary,
          last_call_summary: summary,
          supplier_personality: summary.supplier_personality,
          known_objections: summary.known_objections || [],
          known_restrictions: summary.known_restrictions || [],
          call_type: callType,
          call_summary: `${summary.overall_score}/10`
        };

        if (summary.documents_required) memoryUpdates.documents_required = summary.documents_required;
        if (summary.moq) memoryUpdates.MOQ = summary.moq;
        if (summary.payment_terms) memoryUpdates.payment_terms = summary.payment_terms;
        if (summary.approval_timeline) memoryUpdates.approval_timeline = summary.approval_timeline;
        if (summary.marketplace_policy) memoryUpdates.marketplace_policy = summary.marketplace_policy;

        if (summary.recommended_relationship_stage) {
          memoryUpdates.relationship_stage = summary.recommended_relationship_stage;
        }

        if (summary.recommended_trust_score_adjustment) {
          const current = await loadSupplierMemory(supplierUuid);
          const newScore = Math.max(0, Math.min(10, (current?.trust_score || 5) + summary.recommended_trust_score_adjustment));
          memoryUpdates.trust_score = newScore;
        }

        await updateSupplierMemoryFull(supplierUuid, memoryUpdates);

        // LEARNING INTELLIGENCE UPDATES
        const currentMemory = await loadSupplierMemory(supplierUuid);
        await updateLearningIntelligence(supplierId, companyName, summary, callType, currentMemory);

        // UPGRADE #2: Extract Category Hierarchy
        const hierarchyData = await extractCategoryHierarchy(
          supplierUuid,
          companyName,
          transcript,
          summary,
          summary.product_categories || []
        );

        await saveIncrementalMemory(supplierId, {
          supplier_category: hierarchyData.primary
        });

        // UPGRADE #1: Record Questions
        if (conversationHistory) {
          conversationHistory.forEach((item, idx) => {
            if (item.speaker === 'you' && item.text.includes('?')) {
              const responseLength = conversationHistory[idx + 1]?.text.length || 0;
              const responseEngagement = responseLength > 50 ? 1 : responseLength > 20 ? 0.5 : 0;
              const trustImpact = summary.recommended_trust_score_adjustment || 0;
              const progressionImpact = summary.recommended_relationship_stage !== currentMemory?.relationship_stage ? 1 : 0;
              const resistanceTriggered = summary.red_flags && summary.red_flags.length > 0;
              
              recordQuestionUsage(
                item.text,
                responseLength,
                responseEngagement,
                trustImpact,
                progressionImpact,
                resistanceTriggered
              );
            }
          });
        }

        // UPGRADE #5: Update Playbook with Confidence
        await updatePlaybookWithConfidence(supplierId, {
          supplier_category: hierarchyData.primary,
          communication_style: summary.communication_style || summary.supplier_personality,
          best_performing_approaches: summary.overall_score >= 8 ? [summary.opening_statement].filter(s => s) : [],
          topics_positive_response: summary.supplier_priorities || [],
          topics_negative_response: summary.known_restrictions || [],
          recommended_next_approach: summary.next_natural_conversation
        });

        // UPGRADE #6: Update Behavior Profile with Dynamic Probability
        await updateBehaviorProfileWithDynamicProbability(supplierId, {
          personality_type: summary.supplier_personality,
          communication_style: summary.communication_style,
          positive_signals: summary.positive_signals || [],
          negative_signals: summary.known_objections || []
        }, currentMemory);
      }
    }

    res.json(summary);
  } catch (error) {
    console.error("Analysis error:", error);
    res.status(500).json({ error: "Failed to analyze call", details: error.message });
  }
});

// Questions API
app.get("/api/learning/questions", async (req, res) => {
  try {
    const { data } = await supabase
      .from('question_tracking')
      .select('*')
      .gte('sample_size', 5)
      .order('effectiveness_score', { ascending: false })
      .limit(20);

    res.json({
      high_effectiveness_questions: data || [],
      count: (data || []).length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Category hierarchy API
app.get("/api/supplier/:supplierId/category-hierarchy", async (req, res) => {
  try {
    const { supplierId } = req.params;
    const { data } = await supabase
      .from('supplier_category_cache')
      .select('primary_category, subcategory, products')
      .eq('supplier_id', supplierId)
      .single();

    res.json(data || { message: 'No category detected yet' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Approval model API
app.get("/api/supplier/:supplierId/approval-model", async (req, res) => {
  try {
    const { supplierId } = req.params;
    const { data } = await supabase
      .from('supplier_behavior_profile')
      .select('approval_probability, approval_probability_model')
      .eq('supplier_id', supplierId)
      .single();

    res.json(data || { message: 'No model generated yet' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ Vortex Live Call Copilot v14 running on port ${PORT}`);
  console.log(`✓ UPGRADE #1: True Question Effectiveness`);
  console.log(`✓ UPGRADE #2: Category Hierarchy`);
  console.log(`✓ UPGRADE #3: Recency Weighting`);
  console.log(`✓ UPGRADE #4: Pattern Decay`);
  console.log(`✓ UPGRADE #5: Playbook Confidence`);
  console.log(`✓ UPGRADE #6: Dynamic Approval Probability`);
});
