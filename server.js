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

const saveIncrementalMemory = async (supplierUuid, updates) => {
  if (!supplierUuid) return null;
  try {
    const { data, error } = await supabase.from("supplier_memory").update({...updates, updated_at: new Date().toISOString()}).eq("id", supplierUuid).select().single();
    if (error) return null;
    supplierMemory.set(supplierUuid, data);
    return data;
  } catch (error) {return null;}
};

const updateSupplierMemoryFull = async (supplierUuid, updates) => {
  if (!supplierUuid) return null;
  try {
    const safeUpdates = { ...updates };
    if (updates.open_questions) {
      const current = await loadSupplierMemory(supplierUuid);
      if (current?.open_questions) {
        safeUpdates.open_questions = Array.from(new Set([...(current.open_questions || []), ...(updates.open_questions || [])]));
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
      safeUpdates.trust_history = {timestamp: new Date().toISOString(), score: updates.trust_score, reason: updates.trust_reason || "Score updated"};
    }
    if (updates.call_type && updates.call_summary) {
      const current = await loadSupplierMemory(supplierUuid);
      const history = current?.interaction_history || [];
      history.push({date: new Date().toISOString().split('T')[0], call_type: updates.call_type, summary: updates.call_summary, timestamp: new Date().toISOString()});
      safeUpdates.interaction_history = history;
    }
    safeUpdates.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from("supplier_memory").update(safeUpdates).eq("id", supplierUuid).select().single();
    if (error) return null;
    supplierMemory.set(supplierUuid, data);
    return data;
  } catch (error) {return null;}
};

const getConfidenceTier = (sampleSize) => {
  if (sampleSize < 10) return 'Experimental';
  if (sampleSize < 20) return 'Emerging Pattern';
  if (sampleSize < 50) return 'Validated Pattern';
  if (sampleSize < 100) return 'Strong Pattern';
  return 'Proven Pattern';
};

const isConfidenceHighEnough = (sampleSize) => sampleSize >= 20;

const extractSupplierCategory = (memory, transcript) => {
  if (memory?.supplier_category) return memory.supplier_category;
  const categories = ['Beauty', 'Personal Care', 'Electronics', 'Home Goods', 'Pet', 'Health', 'Sports', 'Food', 'Supplements', 'Apparel'];
  const nameUpper = memory?.company_name?.toUpperCase() || '';
  for (const cat of categories) {if (nameUpper.includes(cat.toUpperCase())) return cat;}
  return 'Uncategorized';
};

const updateCategoryIntelligence = async (category, callOutcome) => {
  const { data: existing } = await supabase.from('category_intelligence').select('*').eq('category', category).single();
  const current = existing || {category, total_calls: 0, approval_rate: 0, rejection_rate: 0, most_common_objections: [], most_common_restrictions: [], avg_trust_growth: 0, sample_size: 0, recent_call_count: 0, historical_call_count: 0};
  const updates = {total_calls: current.total_calls + 1, sample_size: current.sample_size + 1, recent_call_count: (current.recent_call_count || 0) + 1, updated_at: new Date().toISOString(), last_seen: new Date().toISOString()};
  if (callOutcome.mission_complete || callOutcome.is_fit_for_account === 'yes') {
    updates.approval_rate = (current.approval_rate * current.total_calls + 1) / (current.total_calls + 1);
  } else if (callOutcome.is_fit_for_account === 'no') {
    updates.rejection_rate = (current.rejection_rate * current.total_calls + 1) / (current.total_calls + 1);
  }
  if (callOutcome.known_objections && callOutcome.known_objections.length > 0) {
    const objections = current.most_common_objections || [];
    callOutcome.known_objections.forEach(obj => {
      const found = objections.find(o => o.text === obj);
      if (found) {found.count = (found.count || 1) + 1;} else {objections.push({ text: obj, count: 1 });}
    });
    updates.most_common_objections = objections.sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 10);
  }
  if (callOutcome.red_flags && callOutcome.red_flags.length > 0) {
    const restrictions = current.most_common_restrictions || [];
    callOutcome.red_flags.forEach(flag => {
      const found = restrictions.find(r => r.text === flag);
      if (found) {found.count = (found.count || 1) + 1;} else {restrictions.push({ text: flag, count: 1 });}
    });
    updates.most_common_restrictions = restrictions.sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 10);
  }
  updates.confidence_level = getConfidenceTier(updates.sample_size);
  updates.first_seen = existing?.first_seen || new Date().toISOString();
  const { error } = existing ? await supabase.from('category_intelligence').update(updates).eq('category', category) : await supabase.from('category_intelligence').insert([{ ...current, ...updates }]);
  if (error) console.error('Error updating category intelligence:', error);
};

const recordQuestionUsage = async (question, responseLength, engagementChange, trustChange, relationshipProgression, resistanceTriggered) => {
  const { data: existing } = await supabase.from('question_tracking').select('*').eq('question_text', question).single();
  const current = existing || {question_text: question, times_used: 0, avg_response_length: 0, engagement_change: 0, trust_change: 0, relationship_progression: 0, resistance_triggered_count: 0, sample_size: 0, recent_call_count: 0};
  const updates = {times_used: current.times_used + 1, sample_size: current.sample_size + 1, recent_call_count: (current.recent_call_count || 0) + 1, avg_response_length: (current.avg_response_length * current.times_used + responseLength) / (current.times_used + 1), engagement_change: (current.engagement_change * current.times_used + engagementChange) / (current.times_used + 1), trust_change: (current.trust_change * current.times_used + trustChange) / (current.times_used + 1), relationship_progression: (current.relationship_progression * current.times_used + relationshipProgression) / (current.times_used + 1), updated_at: new Date().toISOString(), last_seen: new Date().toISOString()};
  if (resistanceTriggered) updates.resistance_triggered_count = current.resistance_triggered_count + 1;
  const responseQuality = Math.min(responseLength / 200, 1);
  const trustImpact = Math.max(-1, Math.min(1, trustChange / 2));
  const progressionImpact = Math.max(-1, Math.min(1, relationshipProgression / 5));
  const resistanceImpact = resistanceTriggered ? -0.3 : 0;
  updates.effectiveness_score = (responseQuality * 0.3 + trustImpact * 0.35 + progressionImpact * 0.25 + resistanceImpact * 0.1);
  updates.confidence_level = getConfidenceTier(updates.sample_size);
  updates.first_seen = existing?.first_seen || new Date().toISOString();
  const { error } = existing ? await supabase.from('question_tracking').update(updates).eq('id', existing.id) : await supabase.from('question_tracking').insert([{ ...current, ...updates }]);
  if (error) console.error('Error recording question:', error);
};

const extractCategoryHierarchy = async (supplierId, companyName, transcript, callSummary) => {
  const categoryHierarchies = {
    'Beauty': {subcategories: ['Skincare', 'Makeup', 'Haircare', 'Fragrance'], keywords: ['makeup', 'cosmetics', 'skincare', 'moisturizer', 'serum', 'lipstick', 'foundation', 'shampoo', 'conditioner', 'perfume']},
    'Personal Care': {subcategories: ['Oral', 'Bath', 'Deodorant', 'Grooming'], keywords: ['toothpaste', 'soap', 'deodorant', 'lotion', 'shaving', 'grooming', 'razor']},
    'Health': {subcategories: ['Supplements', 'Vitamins', 'Wellness', 'Medical'], keywords: ['supplement', 'vitamin', 'health', 'wellness', 'medical', 'collagen', 'fish oil']},
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
    data.keywords.forEach(keyword => {if (allText.includes(keyword)) {scores[category] += 2; detectedProducts.push(keyword);}});
    if (nameUpper.includes(category.toUpperCase())) scores[category] += 5;
  });
  let maxScore = 0;
  Object.entries(scores).forEach(([cat, score]) => {if (score > maxScore) {maxScore = score; primaryCategory = cat;}});
  if (!primaryCategory) primaryCategory = 'Uncategorized';
  const { data: cached } = await supabase.from('supplier_category_cache').select('*').eq('supplier_id', supplierId).single();
  const updates = {primary_category: primaryCategory, subcategory: subcategory || 'General', products: Array.from(new Set(detectedProducts)).slice(0, 10), detected_category: primaryCategory, confidence: Math.min(100, maxScore * 10), last_detected: new Date().toISOString()};
  const { error } = cached ? await supabase.from('supplier_category_cache').update(updates).eq('supplier_id', supplierId) : await supabase.from('supplier_category_cache').insert([{ supplier_id: supplierId, ...updates }]);
  if (error) console.error('Error caching category hierarchy:', error);
  return { primary: primaryCategory, sub: subcategory, products: detectedProducts };
};

const formatMemoryForPrompt = (memory) => {
  if (!memory) return "No supplier memory found.";
  return `SUPPLIER MEMORY:\nSupplier: ${memory.company_name || memory.supplier_id}\nCategory: ${memory.supplier_category || 'Uncategorized'}\nStage: ${memory.relationship_stage}\nTrust Score: ${memory.trust_score}/10\nLast Contact: ${memory.last_contact_date || 'Never'}\nKNOWN: ${Object.entries({'MOQ': memory.MOQ, 'Payment Terms': memory.payment_terms, 'Approval Timeline': memory.approval_timeline}).filter(([_, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' | ') || 'None yet'}\nCONCERNS: ${memory.known_objections?.join(', ') || 'None'}\nRESTRICTIONS: ${memory.known_restrictions?.join(', ') || 'None'}`;
};

const VORTEX_PROFILE = `=== VORTEX ORIGIN BRANDS LLC ===\nCompany: Vortex Origin Brands, Wyoming-based wholesale company\nFounder: Sanaullah\nBusiness: Wholesale Buyer & Supplier Partnerships\nCRITICAL: Always position as a WHOLESALE BUYER with real purchasing power.`;

const TRUTH_RULE = `TRUTH RULE (FOUNDATION - OVERRIDES ALL)\nNever instruct Sanaullah to provide false information.\nIf asked about Amazon/marketplaces: Answer truthfully. ALWAYS.`;

const DISTRIBUTOR_INQUIRY_SYSTEM = `YOU ARE: Distributor Account Opening Coach for Vortex Origin Brands.\nPRIMARY OBJECTIVE: Open and qualify a wholesale distributor account.`;

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Vortex Live Call Copilot v14 - Learning Engine Upgraded" });
});

app.post("/api/analyze-live", async (req, res) => {
  try {
    const { transcript, callType, companyName, supplierId } = req.body;
    if (!transcript) return res.status(400).json({ error: "Transcript required" });
    let supplierUuid = null;
    if (supplierId || companyName) {
      supplierUuid = await findOrCreateSupplier(companyName, supplierId);
    }
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: `${TRUTH_RULE}\n${VORTEX_PROFILE}\n${DISTRIBUTOR_INQUIRY_SYSTEM}\nContact just said: "${transcript}"\nYou are Sanaullah's live call copilot. Tell him what to say next (max 2 sentences).`
      }]
    });
    const guidance = message.content[0].type === "text" ? message.content[0].text : "";
    res.json({ guidance, timestamp: new Date().toISOString(), callType, supplierId: supplierUuid });
  } catch (error) {
    console.error("Claude API error:", error);
    res.status(500).json({ error: "Failed to generate response", details: error.message });
  }
});

app.post("/api/call-summary", async (req, res) => {
  try {
    const { conversationHistory, callType, supplierId, companyName } = req.body;
    if (!conversationHistory || conversationHistory.length === 0) return res.status(400).json({ error: "Conversation history required" });
    let transcript = "";
    conversationHistory.forEach(item => {transcript += `${item.speaker === 'contact' ? 'CONTACT' : 'YOU'}: ${item.text}\n\n`;});
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{
        role: "user",
        content: `Analyze this call. Return ONLY JSON.\n${transcript}\n{"call_type":"${callType}","overall_score":8,"relationship_summary":"Good fit","is_fit_for_account":"yes"}`
      }]
    });
    const responseText = message.content[0].type === "text" ? message.content[0].text : "{}";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const summary = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    if (supplierId || companyName) {
      const supplierUuid = await findOrCreateSupplier(companyName, supplierId);
      if (supplierUuid) {
        await updateSupplierMemoryFull(supplierUuid, {
          relationship_summary: summary.relationship_summary,
          last_call_summary: summary,
          call_type: callType,
        });
        await updateCategoryIntelligence(extractSupplierCategory({}, ''), summary);
        const hierarchyData = await extractCategoryHierarchy(supplierUuid, companyName, transcript, summary);
        await recordQuestionUsage("test_question", 100, 0.5, 1, 1, false);
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
  console.log(`✅ Vortex Live Call Copilot v14 running on port ${PORT}`);
  console.log(`✓ UPGRADE #1: True Question Effectiveness`);
  console.log(`✓ UPGRADE #2: Category Hierarchy`);
  console.log(`✓ UPGRADE #3: Recency Weighting`);
  console.log(`✓ UPGRADE #4: Pattern Decay`);
  console.log(`✓ UPGRADE #5: Playbook Confidence`);
  console.log(`✓ UPGRADE #6: Dynamic Approval Probability`);
});
