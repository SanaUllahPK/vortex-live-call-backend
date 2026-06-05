import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.post('/api/analyze-live', async (req, res) => {
  try {
    const { transcript, missionType } = req.body;
    
    const response = await claude.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: `Call transcript:\n\n${transcript}\n\nMission: ${missionType}\n\nProvide ONE sentence of real-time coaching for this sales call.`
        }
      ]
    });

    const guidance = response.content[0].type === 'text' ? response.content[0].text : 'Keep listening.';
    
    res.json({ success: true, guidance, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Vortex Live Call Backend' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n✅ Vortex Live Call Backend running on port ${PORT}\n`);
});
