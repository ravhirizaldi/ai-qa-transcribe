import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

// Initialize ElevenLabs Client
// WARNING: This insecurely exposes the API key in the browser.
// In a real app, this should be done server-side.
const elevenlabs = new ElevenLabsClient({
  apiKey: import.meta.env.VITE_ELEVENLABS_API_KEY,
});

export interface TranscriptionResult {
  text: string;
  segments: any[];
}

const convertIndonesianNumbers = (text: string): string => {
  const numberMap: { [key: string]: string } = {
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
      // Remove punctuation for checking but keep it for replacement
      const cleanWord = word
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
        .toLowerCase();
      const punctuation =
        word.match(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g)?.join("") || "";

      if (numberMap[cleanWord]) {
        return numberMap[cleanWord] + punctuation;
      }
      return word;
    })
    .join(" ");
};

export const transcribeAudio = async (
  file: File,
): Promise<TranscriptionResult> => {
  try {
    // Convert File to Blob, then to native File for the SDK if needed,
    // but the SDK 'convert' method accepts a Blob/File directly?
    // The docs say `file: Blob | File | fs.ReadStream`.
    // Let's verify if we need any special handling.
    // Usually passing the File object from the browser is enough.

    const transcription = await elevenlabs.speechToText.convert({
      file: file,
      modelId: "scribe_v2", // Correct model for STT
      tagAudioEvents: false,
      useMultiChannel: false, // Disable multichannel to allow
      diarize: true,
      timestampsGranularity: "word",
      languageCode: "ind",
      numSpeakers: 2,
      temperature: 0.2,
    });

    console.log(transcription);

    // Handle multichannel response
    const allWords: any[] = [];

    if ((transcription as any).transcripts) {
      // Multichannel response - collect words from all channels
      const transcripts = (transcription as any).transcripts;
      for (const transcript of transcripts) {
        const channelWords = transcript.words || [];
        for (const word of channelWords) {
          allWords.push({
            text: word.text,
            start: word.start,
            end: word.end,
            speaker_id:
              word.speaker_id || `channel_${transcript.channel_index}`,
            channel: transcript.channel_index,
            type: word.type,
          });
        }
      }
    } else {
      // Fallback: Single channel response
      const words = (transcription as any).words || [];
      for (const word of words) {
        allWords.push(word); // Keep all word types including spacing
      }
    }

    // Sort all words by timestamp
    allWords.sort((a, b) => a.start - b.start);

    // Group consecutive words by speaker including spacing
    const segments: any[] = [];
    let currentSpeaker: string | null = null;
    let currentSegment: any = null;

    for (const word of allWords) {
      if (word.type === "word") {
        const speakerId = word.speaker_id || word.speakerId || "unknown";

        if (speakerId !== currentSpeaker) {
          // New speaker - save current segment and start new one
          if (currentSegment) {
            currentSegment.text = convertIndonesianNumbers(currentSegment.text);
            segments.push(currentSegment);
          }
          currentSegment = {
            start: word.start,
            end: word.end,
            text: word.text,
            speakerId: speakerId,
            words: [word],
          };
          currentSpeaker = speakerId;
        } else {
          // Same speaker - append word to current segment
          if (currentSegment) {
            currentSegment.text += word.text;
            currentSegment.end = word.end;
            currentSegment.words.push(word);
          }
        }
      } else {
        // Spacing or audio_event - append to current segment
        if (currentSegment) {
          currentSegment.text += word.text || "";
          currentSegment.words.push(word);
        }
      }
    }

    // Add the last segment
    if (currentSegment) {
      currentSegment.text = convertIndonesianNumbers(currentSegment.text);
      segments.push(currentSegment);
    }

    // Get full transcript text
    const fullText = allWords.map((w) => w.text).join("");

    // Return raw segments for batch analysis later
    return {
      text: fullText,
      segments: segments,
    };
  } catch (error) {
    console.error("ElevenLabs Transcription Error:", error);
    throw error;
  }
};
