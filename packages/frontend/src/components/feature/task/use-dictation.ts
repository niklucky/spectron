import { useEffect, useRef, useState } from "react";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
export function useDictation(onText: (text: string) => void) {
  const speechWindow = window as SpeechWindow;
  const Constructor =
    speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  const [listening, setListening] = useState(false),
    [interim, setInterim] = useState(""),
    [error, setError] = useState("");
  const recognition = useRef<Recognition | null>(null),
    callback = useRef(onText);
  callback.current = onText;
  useEffect(
    () => () => {
      if (recognition.current) {
        recognition.current.onresult = null;
        recognition.current.onend = null;
        recognition.current.onerror = null;
        recognition.current.abort();
      }
    },
    [],
  );
  const toggle = (language: string) => {
    if (recognition.current) {
      recognition.current.stop();
      return;
    }
    if (!Constructor) {
      setError(
        "Voice input is unavailable in this browser. You can use your keyboard’s dictation or open the app in a browser with speech recognition.",
      );
      return;
    }
    const next = new Constructor();
    recognition.current = next;
    next.lang = language;
    next.continuous = true;
    next.interimResults = true;
    next.onresult = (event) => {
      let pending = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        if (result.isFinal) callback.current(result[0].transcript);
        else pending += result[0].transcript;
      }
      setInterim(pending);
    };
    next.onerror = (event) => {
      const messages: Record<string, string> = {
        "not-allowed":
          "Microphone access was denied. Allow it in your browser to dictate.",
        "service-not-allowed":
          "Speech recognition is unavailable in this browser.",
        "audio-capture": "No microphone is available.",
        "no-speech": "No speech detected. Try again.",
        network: "Speech recognition could not connect. Try again.",
      };
      if (event.error !== "aborted")
        setError(
          messages[event.error] ?? "Could not recognize speech. Try again.",
        );
      next.abort();
      recognition.current = null;
      setListening(false);
      setInterim("");
    };
    next.onend = () => {
      recognition.current = null;
      setListening(false);
      setInterim("");
    };
    setError("");
    try {
      next.start();
      setListening(true);
    } catch {
      recognition.current = null;
      setError("Could not start voice input. Try again.");
    }
  };
  return { listening, interim, error, toggle };
}
