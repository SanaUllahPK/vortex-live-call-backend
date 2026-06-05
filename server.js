import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Vortex Live Call Backend" });
});

app.post("/api/analyze-live", async (req, res) => {
  try {
    const { transcript, missionType, conversationHistory, brief } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: "Transcript required" });
    }

    // Build context from conversation history
    let context = "";
    if (conversationHistory && conversationHistory.length > 0) {
      context = "Previous conversation:\n";
      conversationHistory.forEach(item => {
        context += `${item.speaker === 'supplier' ? 'Supplier' : 'You'}: ${item.text}\n`;
      });
      context += "\n";
    }

    // Build brief context
    let briefContext = "";
    if (brief && brief.trim()) {
      briefContext = `CALL BRIEF & STRATEGY:\n${brief}\n\n`;
    }

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 120,
      messages: [
        {
          role: "user",
          content: `You are a professional sales rep on a Discovery call.

${briefContext}${context}Supplier just said: "${transcript}"

Generate EXACTLY what you should say next (1-2 sentences max). Follow the call brief. Be natural and confident.`
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
