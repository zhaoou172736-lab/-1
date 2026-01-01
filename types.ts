export type ProviderType = 'gemini' | 'openai';

export interface AppSettings {
  provider: ProviderType;
  model: string;
  baseUrl: string;
  apiKey: string;
}

export interface MetaData {
  topic?: string;
  audience?: string[];
  viral_tags?: string[];
  tags?: string[];
}

export interface AnalysisState {
  isAnalyzing: boolean;
  progress: number;
  step: string;
  resultHtml: string | null;
  metaData: MetaData | null;
  summary: string | null;
  error: string | null;
}

export interface VideoFile {
  file: File;
  previewUrl: string;
  base64: string;
  mimeType: string;
}
