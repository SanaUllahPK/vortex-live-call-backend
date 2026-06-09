# Vortex Live Call Copilot — Notes

## Run backend
cd ~/vortex-live-call-backend
node --env-file=.env server.js

## .env requires
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLAUDE_API_KEY, PHASE_2_ENABLED=true, PORT=3001

## Run frontend
cd ~/vortex-live-call && npm run dev

## Kill backend
lsof -ti:3001 | xargs kill -9

## Fixes applied 2026-06-07
1. findSupplier: changed `.eq("name", ...)` to `.eq("normalized_name", ...)` at server.js:42
2. extractMissingInfo: now workflow-aware, takes callType, uses WORKFLOW_FIELDS map
3. generateSuggestedQuestion: now workflow-aware, takes callType, uses WORKFLOW_QUESTIONS map
4. combineInsights: signature now includes callType

## Call types
distributor_inquiry, wholesale_inquiry, brand_registry, quick_note, retail_inquiry

## Test command
curl -s -X POST http://localhost:3001/api/analyze-live -H "Content-Type: application/json" -d '{"companyName":"Essential Palace","callType":"distributor_inquiry","transcript":"hi","conversationHistory":[]}'

## Test supplier
"Essential Palace" exists and has open_questions data

## Known limitations
- Frontend BRIEF field is wired as companyName in POST body
- No dotenv import in server.js (must use --env-file flag)
- 6 of 7 intelligence sources empty for most suppliers
- No post-call write-back yet

## Backups
server.js.backup-step1 through step4 in same folder

## Do not
- Redesign architecture
- Add new tables
- Propose LLM integration yet
