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
    const { transcript, missionType } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: "Transcript required" });
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `You are a professional sales representative. The supplier just said:

"${transcript}"

You are on a Discovery call with this supplier (mission: ${missionType}).

Generate EXACTLY what you should say next to them. Your response should be:
- Professional and confident
- Builds on what they just said
- Asks a follow-up question OR moves the conversation forward
- 1-3 sentences max

IMPORTANT: Generate the EXACT words you should say - not a coaching tip. This is your response to them.`,
        },
      ],
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
