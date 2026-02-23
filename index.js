const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const getApiKey = () => `${process.env.GROQ_API_KEY || ''}`.trim();

app.get('/health', (_req, res) => {
  return res.json({
    ok: true,
    service: 'ipc-backend',
    model,
    groqConfigured: Boolean(getApiKey()),
  });
});

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
    return `${scenario}\n\n${sharedContext}\nStrictly use simple Hinglish (Roman Hindi). English sentences mat likho; sirf legal terms jaise BNS/Section/FIR allowed hain.\n\nOutput format:\n* Section <number>: <short section title in Hinglish>\n- Kyun lagu hota hai: <ek line, simple Hinglish>\n\nRules:\n1) Sirf BNS sections + why applicable.\n2) Punishment, safety advice, ya next steps mat do.\n3) Do not mention IPC.`;
  }

  if (analysisType === 'punishments') {
    if (audienceMode === 'professional') {
      return `${scenario}\n\n${sharedContext}\nProvide punishment exposure for applicable BNS provisions in formal legal English.\n\nStrict output format (repeat this 3-line block for each section):\n* Section <number>: <official section heading>\n- Legal basis: <concise element-based applicability reason>\n- Sentencing exposure: <imprisonment/fine range in statutory wording>\n\nRules:\n1) No extra headings.\n2) No disclaimer.\n3) No extra bullet types.\n4) Keep it concise and technically precise.\n5) If multiple sections apply, separate each 3-line block with one blank line.\n6) Do not mention IPC.`;
    }
    return `${scenario}\n\n${sharedContext}\nStrictly use simple Hinglish (Roman Hindi). English sentences mat likho; sirf legal terms jaise BNS/Section/FIR allowed hain. Do not mention IPC.\n\nStrict output format (repeat this 3-line block for each section):\n* Section <number>: <section title in Hinglish>\n- Kyun lagu hota hai: <one short reason in Hinglish>\n- Sambhavit saza: <jail/fine range in simple Hinglish>\n\nRules:\n1) No extra headings.\n2) No legal disclaimer.\n3) No extra bullet types.\n4) Keep it short and practical.\n5) If multiple sections apply, separate each 3-line block with one blank line.`;
  }

  if (role === 'self') {
    if (audienceMode === 'professional') {
      return `${scenario}\n\n${sharedContext}\nProvide a legally rigorous action plan in English for advising the affected person: (1) immediate protective/legal actions, and (2) post-incident procedural strategy, including reporting, evidence preservation, and counsel steps. Keep it concise. Do not mention IPC.`;
    }
    return `${scenario}\n\n${sharedContext}\nStrictly use simple Hinglish (Roman Hindi). English sentences mat likho; sirf legal terms jaise BNS/Section/FIR allowed hain.\nFocus only on what the user should do next: (1) immediate actions during the incident, and (2) actions after the incident. Keep it practical and safety-first. Do not mention IPC.`;
  }

  if (audienceMode === 'professional') {
    return `${scenario}\n\n${sharedContext}\nProvide a legally rigorous witness-side action framework in English: (1) immediate safe intervention boundaries, and (2) post-incident procedural steps including reporting channels, evidence integrity, and witness statement protocol. Keep it concise. Do not mention IPC.`;
  }

  return `${scenario}\n\n${sharedContext}\nStrictly use simple Hinglish (Roman Hindi). English sentences mat likho; sirf legal terms jaise BNS/Section/FIR allowed hain.\nFocus only on what a witness should do next: (1) immediate safe actions during the incident, and (2) actions after the incident including reporting, preserving evidence, and giving witness statement. Keep it practical and safety-first. Do not mention IPC.`;
};

const buildLanguageNormalizationPrompt = (audienceMode, content) => {
  if (audienceMode === 'professional') {
    return [
      {
        role: 'system',
        content:
          'Rewrite text into strict formal legal English only. Remove any Hindi/Hinglish words. Preserve legal meaning, section numbers, and structure. No extra commentary.',
      },
      {
        role: 'user',
        content: `Normalize this answer to strict English:\n\n${content}`,
      },
    ];
  }

  return [
    {
      role: 'system',
      content:
        'Rewrite text into strict simple Hinglish (Roman Hindi) only. Never use Devanagari script characters (Unicode range \\u0900-\\u097F). Output must be Latin script only. Full English sentences allowed nahi hain; sirf legal tokens jaise BNS, Section, FIR, jail, fine rakh sakte ho. Bracket me English translation hatao. Meaning same rakho. No extra commentary.',
    },
    {
      role: 'user',
      content: `Normalize this answer to strict Hinglish:\n\n${content}`,
    },
  ];
};

const stripDevanagariScript = (text) =>
  `${text || ''}`
    .replace(/[\u0900-\u097F]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const callGroqChat = async (apiKey, messages) =>
  axios.post(
    GROQ_CHAT_URL,
    {
      model,
      temperature: 0,
      messages,
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

const extractMessageContent = (response) =>
  response?.data?.choices?.[0]?.message?.content
    ? `${response.data.choices[0].message.content}`.trim()
    : '';

const normalizeAudienceLanguage = async (apiKey, audienceMode, content) => {
  const base = `${content || ''}`.trim();
  if (!base) return base;
  try {
    const normalizeResponse = await callGroqChat(
      apiKey,
      buildLanguageNormalizationPrompt(audienceMode, base)
    );
    const normalized = extractMessageContent(normalizeResponse);
    const effective = normalized || base;
    if (audienceMode === 'general') {
      return stripDevanagariScript(effective);
    }
    return effective;
  } catch (normalizeError) {
    const providerError =
      normalizeError.response?.data?.error?.message ||
      normalizeError.response?.data?.error ||
      normalizeError.message ||
      'Unknown provider error';
    console.error('Language normalize fallback:', providerError);
    if (audienceMode === 'general') {
      return stripDevanagariScript(base);
    }
    return base;
  }
};

app.post('/analyze', async (req, res) => {
  const apiKey = getApiKey();
  const scenario = `${req.body?.scenario || ''}`.trim();
  const role = normalizeRole(req.body?.role);
  const audienceMode = normalizeAudienceMode(req.body?.audienceMode);
  const analysisType = normalizeAnalysisType(req.body?.analysisType);
  const categoryKey = normalizeCategoryKey(req.body?.categoryKey);

  if (!scenario) {
    return res.status(400).json({ error: 'Scenario is required.' });
  }

  if (!apiKey) {
    return res.status(500).json({
      error:
        'GROQ_API_KEY is not configured. Create backend/ipc-backend/.env and add GROQ_API_KEY=YOUR_KEY.',
    });
  }

  const userPrompt = buildUserPrompt({
    scenario,
    role,
    audienceMode,
    analysisType,
    categoryKey,
  });

  try {
    const response = await callGroqChat(apiKey, [
      {
        role: 'system',
        content: buildSystemPrompt(audienceMode),
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ]);

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

    const reply = extractMessageContent(response);
    const normalizedReply = await normalizeAudienceLanguage(apiKey, audienceMode, reply);
    return res.json({
      result: normalizedReply,
      meta: { role, audienceMode, analysisType, categoryKey },
    });
  } catch (err) {
    const status = err.response?.status;
    const providerError =
      err.response?.data?.error?.message ||
      err.response?.data?.error ||
      err.message ||
      'Unknown provider error';
    console.error('Error:', status ? `[${status}] ${providerError}` : providerError);
    return res.status(500).json({
      error: `Failed to get response from Groq: ${providerError}`,
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  if (!getApiKey()) {
    console.warn(
      'Warning: GROQ_API_KEY is missing. /analyze will fail until backend/ipc-backend/.env is configured.'
    );
  }
});
