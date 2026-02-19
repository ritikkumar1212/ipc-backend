const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const apiKey = process.env.GROQ_API_KEY;
const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const CATEGORY_HINTS = {
  robbery:
    'Prioritize violent dispossession/theft factors, use of weapon, threat or force, and victim intimidation details.',
  fraud:
    'Prioritize deception pattern, false representation or forged records, wrongful gain, victim reliance, and financial loss trail.',
  assault:
    'Prioritize actus reus details of physical attack, weapon/object used, injury severity, intent/knowledge, and medical evidence.',
};

const normalizeAudienceMode = (value) =>
  value === 'professional' ? 'professional' : 'general';

const normalizeRole = (value) => (value === 'witness' ? 'witness' : 'self');

const normalizeAnalysisType = (value) => {
  if (value === 'punishments') return 'punishments';
  if (value === 'next_steps') return 'next_steps';
  return 'sections';
};

const normalizeCategoryKey = (value) => {
  if (value === 'robbery' || value === 'fraud' || value === 'assault') return value;
  return null;
};

const buildSystemPrompt = (audienceMode) => {
  if (audienceMode === 'professional') {
    return 'You are an Indian criminal law drafting assistant for BNS matters. Use formal legal English, precise statutory terminology, and follow output format instructions strictly. Do not mention IPC unless explicitly asked.';
  }
  return 'You are an Indian criminal law helper for the general public. Respond in simple Hinglish (Roman script), practical language, and follow output format instructions strictly. Do not mention IPC unless explicitly asked.';
};

const buildUserPrompt = ({
  scenario,
  role,
  audienceMode,
  analysisType,
  categoryKey,
}) => {
  const roleContext =
    role === 'self'
      ? 'Context: This incident is happening to the user or directly affecting them.'
      : 'Context: The user is only a witness/bystander, and the incident is not directly affecting them.';
  const categoryContext = categoryKey
    ? `Category hint: ${CATEGORY_HINTS[categoryKey]}`
    : '';
  const sharedContext = `${roleContext}${categoryContext ? `\n${categoryContext}` : ''}`;

  if (analysisType === 'sections') {
    if (audienceMode === 'professional') {
      return `${scenario}\n\n${sharedContext}\nProvide a charge-framing style BNS output aligned with real proceedings practice (FIR/charge-sheet screening stage).\n\nStrict output format (repeat block per sustainable charge):\n* Charge <number> (<Primary/Alternate>): Section <number> - <official section heading>\n- Classification: <Cognizable/Non-cognizable>; <Bailable/Non-bailable>; Triable by <court>\n- Proceeding note: <read with attempt/common intention/common object/abetment/conspiracy, if applicable; else NA>\n- Ingredient mapping: <one-line mapping of material facts to legal ingredients>\n\nRules:\n1) Include only legally sustainable BNS charges on given facts.\n2) Use official section headings.\n3) Keep it concise but technically precise.\n4) No safety advice, no disclaimer.\n5) Do not mention IPC.`;
    }
    return `${scenario}\n\n${sharedContext}\nReturn only the relevant BNS section numbers and section titles as a short list. Do not include explanations, punishments, safety advice, or any extra text. Do not mention IPC.`;
  }

  if (analysisType === 'punishments') {
    if (audienceMode === 'professional') {
      return `${scenario}\n\n${sharedContext}\nProvide punishment exposure for applicable BNS provisions in formal legal English.\n\nStrict output format (repeat this 3-line block for each section):\n* Section <number>: <official section heading>\n- Legal basis: <concise element-based applicability reason>\n- Sentencing exposure: <imprisonment/fine range in statutory wording>\n\nRules:\n1) No extra headings.\n2) No disclaimer.\n3) No extra bullet types.\n4) Keep it concise and technically precise.\n5) If multiple sections apply, separate each 3-line block with one blank line.\n6) Do not mention IPC.`;
    }
    return `${scenario}\n\n${sharedContext}\nGive only punishment-focused output for relevant BNS sections in Hinglish. Do not mention IPC.\n\nStrict output format (repeat this 3-line block for each section):\n* Section <number>: <section title>\n- Why it applies: <one short reason>\n- Likely punishment: <jail/fine range in simple words>\n\nRules:\n1) No extra headings.\n2) No legal disclaimer.\n3) No extra bullet types.\n4) Keep it short and practical.\n5) If multiple sections apply, separate each 3-line block with one blank line.`;
  }

  if (role === 'self') {
    return `${scenario}\n\n${sharedContext}\nFocus only on what the user should do next: (1) immediate actions during the incident, and (2) actions after the incident. Keep it practical and safety-first. Do not mention IPC.`;
  }

  return `${scenario}\n\n${sharedContext}\nFocus only on what a witness should do next: (1) immediate safe actions during the incident, and (2) actions after the incident including reporting, preserving evidence, and giving witness statement. Keep it practical and safety-first. Do not mention IPC.`;
};

app.post('/analyze', async (req, res) => {
  const scenario = `${req.body?.scenario || ''}`.trim();
  const role = normalizeRole(req.body?.role);
  const audienceMode = normalizeAudienceMode(req.body?.audienceMode);
  const analysisType = normalizeAnalysisType(req.body?.analysisType);
  const categoryKey = normalizeCategoryKey(req.body?.categoryKey);

  if (!scenario) {
    return res.status(400).json({ error: 'Scenario is required.' });
  }

  if (audienceMode === 'professional' && analysisType === 'next_steps') {
    return res.status(400).json({
      error: 'next_steps is disabled for professional mode.',
    });
  }

  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY is not configured.' });
  }

  const userPrompt = buildUserPrompt({
    scenario,
    role,
    audienceMode,
    analysisType,
    categoryKey,
  });

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: buildSystemPrompt(audienceMode),
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'Nyay Sathi',
        },
      }
    );

    if (
      !response.data ||
      !response.data.choices ||
      !response.data.choices[0] ||
      !response.data.choices[0].message ||
      !response.data.choices[0].message.content
    ) {
      console.error('Unexpected API response:', JSON.stringify(response.data, null, 2));
      return res.status(500).json({ error: 'Invalid response from model.' });
    }

    const reply = response.data.choices[0].message.content;
    return res.json({
      result: reply,
      meta: { role, audienceMode, analysisType, categoryKey },
    });
  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Failed to get response from Groq.' });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
