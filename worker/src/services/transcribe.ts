import { createReadStream } from "node:fs";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import ivrFiltersConfig from "../data/ivr_filters.json";

const ivrFilters = Object.values(ivrFiltersConfig).flat() as string[];

const convertIndonesianNumbers = (text: string): string => {
  const numberMap: Record<string, string> = {
    nol: "0",
    kosong: "0",
    satu: "1",
    dua: "2",
    tiga: "3",
    empat: "4",
    lima: "5",
    enam: "6",
    tujuh: "7",
    delapan: "8",
    sembilan: "9",
    sepuluh: "10",
    sebelas: "11",
  };

  return text
    .split(" ")
    .map((word) => {
      const cleanWord = word.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "").toLowerCase();
      const punctuation = word.match(/[.,/#!$%^&*;:{}=\-_`~()]/g)?.join("") || "";
      return numberMap[cleanWord] ? numberMap[cleanWord] + punctuation : word;
    })
    .join(" ");
};

export type RawSegment = {
  start: number;
  end: number;
  text: string;
  speakerId: string;
  words: unknown[];
};

export const transcribeAudioFile = async (filePath: string, apiKey: string) => {
  const elevenlabs = new ElevenLabsClient({ apiKey });
  const stream = createReadStream(filePath);
  const transcription = await elevenlabs.speechToText.convert({
    file: stream as any,
    modelId: "scribe_v2",
    tagAudioEvents: false,
    useMultiChannel: false,
    diarize: true,
    timestampsGranularity: "word",
    languageCode: "ind",
    numSpeakers: 2,
    temperature: 0.2,
  });

  const allWords: any[] = [];

  if ((transcription as any).transcripts) {
    const transcripts = (transcription as any).transcripts;
    for (const transcript of transcripts) {
      for (const word of transcript.words || []) {
        allWords.push({
          ...word,
          speaker_id: word.speaker_id || `channel_${transcript.channel_index}`,
        });
      }
    }
  } else {
    const words = (transcription as any).words || [];
    allWords.push(...words);
  }

  allWords.sort((a, b) => (a.start || 0) - (b.start || 0));

  const segments: RawSegment[] = [];
  let currentSpeaker: string | null = null;
  let currentSegment: RawSegment | null = null;

  for (const word of allWords) {
    if (word.type === "word") {
      const speakerId = word.speaker_id || word.speakerId || "unknown";
      if (speakerId !== currentSpeaker) {
        if (currentSegment) {
          currentSegment.text = convertIndonesianNumbers(currentSegment.text);
          segments.push(currentSegment);
        }
        currentSegment = {
          start: Number(word.start || 0),
          end: Number(word.end || 0),
          text: word.text || "",
          speakerId,
          words: [word],
        };
        currentSpeaker = speakerId;
      } else if (currentSegment) {
        currentSegment.text += word.text || "";
        currentSegment.end = Number(word.end || currentSegment.end);
        currentSegment.words.push(word);
      }
    } else if (currentSegment) {
      currentSegment.text += word.text || "";
      currentSegment.words.push(word);
    }
  }

  if (currentSegment) {
    currentSegment.text = convertIndonesianNumbers(currentSegment.text);
    segments.push(currentSegment);
  }

  const cleanedSegments = segments
    .map((seg) => {
      let cleanedText = seg.text || "";
      for (const phrase of ivrFilters) {
        const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        cleanedText = cleanedText.replace(new RegExp(escapedPhrase, "gi"), "");
      }
      cleanedText = cleanedText.replace(/\s+/g, " ").trim();
      cleanedText = cleanedText.replace(/^[\s,.-]+/, "");
      return { ...seg, text: cleanedText };
    })
    .filter((seg) => seg.text.length > 0);

  return {
    text: cleanedSegments.map((seg) => seg.text).join(" "),
    segments: cleanedSegments,
  };
};
