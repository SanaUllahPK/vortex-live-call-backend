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
  process.env.SUPABASE_URL || "https://zwxqtzxkizjocbegixsd.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "sb_secret_DdZnljniQu3crVmD4vkPCA_DqyxO1LV"
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
