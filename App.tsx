import React, { useState, useRef, useEffect } from 'react';
import { AppSettings, MetaData, AnalysisState, VideoFile, ProviderType } from './types';
import { DEFAULT_SETTINGS, SYSTEM_PROMPT } from './constants';

// --- Icons (using FontAwesome classes from index.html) ---
const Icons = {
  Settings: () => <i className="fas fa-cog"></i>,
  Close: () => <i className="fas fa-times"></i>,
  Upload: () => <i className="fas fa-cloud-upload-alt"></i>,
  Sparkles: () => <i className="fas fa-magic"></i>,
  Copy: () => <i className="fas fa-copy"></i>,
  Delete: () => <i className="fas fa-trash"></i>,
  Expand: () => <i className="fas fa-expand"></i>,
  Compress: () => <i className="fas fa-compress"></i>,
  User: () => <i className="fas fa-user"></i>,
  Star: () => <i className="fas fa-star"></i>,
  Check: () => <i className="fas fa-check"></i>,
};

export default function App() {
  // State
  const [video, setVideo] = useState<VideoFile | null>(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settings, setSettings] = useState<Record<string, AppSettings>>(() => {
    // Load from localStorage or default
    const savedProvider = localStorage.getItem('provider') as ProviderType || 'openai';
    const customBaseUrl = localStorage.getItem('customBaseUrl');
    const customApiKey = localStorage.getItem('customApiKey');
    const customModel = localStorage.getItem('customModel');

    const newSettings = { ...DEFAULT_SETTINGS };
    
    // Apply saved values to the current active provider in a generic way or specific way
    // For simplicity, we just store the active preference. 
    // But to match the original app structure, let's keep the active provider state separate.
    return newSettings;
  });
  
  const [activeProvider, setActiveProvider] = useState<ProviderType>(() => 
    (localStorage.getItem('provider') as ProviderType) || 'openai'
  );

  // We need to manage the input fields state for the modal independently
  const [tempSettings, setTempSettings] = useState<AppSettings>(DEFAULT_SETTINGS['openai']);

  const [analysis, setAnalysis] = useState<AnalysisState>({
    isAnalyzing: false,
    progress: 0,
    step: 'Ready',
    resultHtml: null,
    metaData: null,
    summary: null,
    error: null,
  });

  const [insight, setInsight] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loadingText, setLoadingText] = useState("正在连接大模型分析画面，请稍候...");

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressIntervalRef = useRef<number | null>(null);

  // --- Effects ---
  useEffect(() => {
    // Initialize temp settings based on active provider
    const currentSettings = { ...DEFAULT_SETTINGS[activeProvider] };
    const savedBaseUrl = localStorage.getItem('customBaseUrl');
    const savedApiKey = localStorage.getItem('customApiKey');
    const savedModel = localStorage.getItem('customModel');

    if (savedBaseUrl) currentSettings.baseUrl = savedBaseUrl;
    if (savedApiKey) currentSettings.apiKey = savedApiKey;
    if (savedModel) currentSettings.model = savedModel;

    setTempSettings(currentSettings);
  }, [activeProvider, settingsModalOpen]);

  // --- Helpers ---
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const previewUrl = URL.createObjectURL(file);
      
      // Read as Base64
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        const base64Content = base64String.split(',')[1];
        setVideo({
          file,
          previewUrl,
          base64: base64Content,
          mimeType: file.type || 'video/mp4'
        });
        setAnalysis(prev => ({ ...prev, resultHtml: null, metaData: null, error: null }));
        setInsight(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeVideo = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (video) {
      URL.revokeObjectURL(video.previewUrl);
      setVideo(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleSettings = () => {
    setSettingsModalOpen(!settingsModalOpen);
  };

  const saveSettings = () => {
    localStorage.setItem('provider', activeProvider);
    if (tempSettings.baseUrl) localStorage.setItem('customBaseUrl', tempSettings.baseUrl);
    else localStorage.removeItem('customBaseUrl');
    
    if (tempSettings.apiKey) localStorage.setItem('customApiKey', tempSettings.apiKey);
    else localStorage.removeItem('customApiKey');
    
    if (tempSettings.model) localStorage.setItem('customModel', tempSettings.model);
    else localStorage.removeItem('customModel');

    setSettingsModalOpen(false);
    alert(`✅ ${activeProvider === 'gemini' ? 'Gemini' : 'OpenAI'} 模式配置已保存！`);
  };

  const startFakeProgress = () => {
    setAnalysis(prev => ({ ...prev, isAnalyzing: true, progress: 0, error: null }));
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    
    let w = 0;
    progressIntervalRef.current = window.setInterval(() => {
      setAnalysis(prev => {
        let nextW = prev.progress;
        if (nextW < 30) nextW += Math.random() * 3;
        else if (nextW < 70) nextW += Math.random() * 0.5;
        else if (nextW < 95) nextW += Math.random() * 0.1;
        
        if (nextW > 99) nextW = 99;
        return { ...prev, progress: nextW };
      });
    }, 200);
  };

  const finishProgress = () => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    setAnalysis(prev => ({ ...prev, progress: 100, isAnalyzing: false }));
  };

  const parseResponse = (text: string) => {
    // 1. Extract Meta JSON
    let metaData: MetaData | null = null;
    
    // Strategy 1: HTML Comment
    const metaTagMatch = text.match(/<!--\s*META:\s*([\s\S]*?)\s*-->/);
    if (metaTagMatch && metaTagMatch[1]) {
        try {
            const raw = metaTagMatch[1].trim().replace(/^```json/, '').replace(/^```/, '').replace(/```$/, '');
            metaData = JSON.parse(raw);
        } catch (e) {}
    }

    // Strategy 2: Markdown Code Block
    if (!metaData) {
        const codeBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch && codeBlockMatch[1]) {
            try {
                metaData = JSON.parse(codeBlockMatch[1]);
            } catch (e) {}
        }
    }

    // Strategy 3: Brute Force
    if (!metaData) {
        const startIdx = text.indexOf('{');
        if (startIdx !== -1) {
            const searchLimit = Math.min(text.length, startIdx + 2000);
            for (let i = startIdx + 1; i < searchLimit; i++) {
                if (text[i] === '}') {
                    const potentialJson = text.substring(startIdx, i + 1);
                    try {
                        const parsed = JSON.parse(potentialJson);
                        if (parsed.topic || parsed.audience) {
                            metaData = parsed;
                            break; 
                        }
                    } catch (e) {}
                }
            }
        }
    }

    // 2. Extract Summary Insight
    const summaryMatch = text.match(/<!--\s*SUMMARY:\s*([\s\S]*?)\s*-->/);
    if (summaryMatch && summaryMatch[1]) {
      setInsight(summaryMatch[1].trim());
    }

    // 3. Clean HTML
    const cleanHtml = text.replace(/```html/g, '').replace(/```/g, '');
    
    setAnalysis(prev => ({
      ...prev,
      resultHtml: cleanHtml,
      metaData: metaData
    }));
  };

  const runAnalysis = async () => {
    if (!video) return;
    
    const apiKey = tempSettings.apiKey; // Using the temp settings as current effective settings
    const baseUrl = tempSettings.baseUrl.replace(/\/$/, "");
    const model = tempSettings.model;

    if (!apiKey && baseUrl === DEFAULT_SETTINGS[activeProvider].baseUrl) {
      if (!confirm("⚠️ 未检测到 API Key。请点击右上角⚙️配置。是否继续尝试 (可能失败)？")) {
        return;
      }
    }

    startFakeProgress();
    setLoadingText(activeProvider === 'gemini' ? "Gemini 正在思考..." : "AI 正在分析...");

    try {
      let data;
      const headers = { 'Content-Type': 'application/json' };
      if (activeProvider === 'openai') {
        headers['Authorization'] = `Bearer ${apiKey}`;
        const payload = {
          model: model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { 
              role: "user", 
              content: [
                { type: "text", text: "Please analyze this video file." },
                {
                  type: "image_url",
                  image_url: { url: `data:${video.mimeType};base64,${video.base64}` }
                }
              ]
            }
          ],
          temperature: 0.7,
          max_tokens: 2000,
          stream: false
        };
        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
        
        finishProgress();
        if (data.choices && data.choices[0].message) {
            parseResponse(data.choices[0].message.content);
        } else {
            throw new Error("API Response format error");
        }

      } else {
        // Gemini
        const url = `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const payload = {
            contents: [{
                parts: [
                    { text: SYSTEM_PROMPT },
                    { inlineData: { mimeType: video.mimeType, data: video.base64 } }
                ]
            }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 2000 }
        };
        const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
        
        finishProgress();
        if (data.candidates && data.candidates[0].content) {
            parseResponse(data.candidates[0].content.parts[0].text);
        } else {
            throw new Error("API Response format error");
        }
      }

    } catch (err: any) {
      finishProgress();
      setAnalysis(prev => ({ ...prev, error: err.message }));
    }
  };

  const copyOutput = () => {
    if (analysis.resultHtml) {
        // Create a temporary container to extract text or just copy innerHTML? 
        // Typically users want the text content formatted or the HTML. 
        // The original code copied the displayed text.
        const outputDiv = document.getElementById("aiOutput");
        if (outputDiv) {
            const range = document.createRange();
            range.selectNode(outputDiv);
            window.getSelection()?.removeAllRanges();
            window.getSelection()?.addRange(range);
            document.execCommand("copy");
            window.getSelection()?.removeAllRanges();
            alert("已复制到剪贴板");
        }
    }
  };

  return (
    <div className="min-h-screen flex flex-col relative text-stone-700">
      {/* Navigation */}
      <nav className="bg-white shadow-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-2">
              <span className="text-2xl">🔥</span>
              <span className="text-xl font-bold text-stone-800">
                爆款拆解助手 <span className="text-xs text-white bg-gradient-to-r from-blue-500 to-purple-600 px-2 py-0.5 rounded-full ml-2 shadow-sm">AI Core</span>
              </span>
            </div>
            <div className="flex items-center">
              <button onClick={toggleSettings} className="flex items-center text-stone-500 hover:text-stone-800 px-3 py-2 rounded-lg hover:bg-stone-100 transition duration-200" title="API 设置">
                <span className="mr-1.5"><Icons.Settings /></span>
                <span className="text-sm font-medium">API 设置</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="flex-grow container mx-auto px-4 py-8 sm:px-6 lg:px-8 max-w-6xl flex flex-col justify-center">
        
        {/* Header Section */}
        <div className="text-center mb-10">
          <h1 className="text-3xl md:text-4xl font-extrabold text-stone-900 mb-4">
            上传视频，AI <span className="text-orange-600">全自动拆解</span> 逻辑
          </h1>
          {insight ? (
             <div className="text-lg text-stone-800 max-w-4xl mx-auto bg-orange-50 p-4 rounded-xl border border-orange-200 shadow-sm transition-all duration-500 ease-in-out transform scale-105">
                🚀 <span className="font-bold text-orange-600 text-xl">{insight}</span>
             </div>
          ) : (
             <p className="text-lg text-stone-600 max-w-2xl mx-auto transition-all duration-500 ease-in-out">
                直接上传爆款视频文件，AI 将自动分析并揭秘其<span className="font-bold text-stone-700">“画面、脚本与情绪”</span>背后的流量密码。
            </p>
          )}
        </div>

        {/* Tool Interface */}
        <div className="flex flex-col gap-8 max-w-5xl mx-auto w-full"> 
            
            {/* Top Section: Input & Actions & META CARD */}
            <div className="flex flex-col gap-6 w-full">
                
                {/* Upload & Action Card */}
                <div className="bg-white p-6 rounded-2xl shadow-lg border border-stone-200 flex flex-col flex-1 transform transition hover:scale-[1.002] duration-300 relative z-10">
                    <div className="mb-2 flex-grow flex flex-col">
                        <label className="block text-base font-bold text-stone-800 mb-4 flex items-center justify-between">
                            <span className="flex items-center">
                                <span className="bg-stone-800 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs mr-2">1</span> 
                                上传爆款视频文件 (上传后自动分析)
                            </span>
                            <span className="text-xs font-normal text-stone-400 bg-stone-100 px-2 py-1 rounded">无限制 | 自动运行</span>
                        </label>
                        
                        {/* Drag & Drop Zone */}
                        <div 
                          className={`drop-zone flex-grow rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-stone-50 relative overflow-hidden group min-h-[250px] border-2 border-dashed ${video ? 'border-orange-500' : 'border-stone-300'}`}
                          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('bg-stone-50'); }}
                          onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('bg-stone-50'); }}
                          onDrop={(e) => {
                             e.preventDefault();
                             e.currentTarget.classList.remove('bg-stone-50');
                             if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                               const event = { target: { files: e.dataTransfer.files } } as unknown as React.ChangeEvent<HTMLInputElement>;
                               handleFileSelect(event);
                             }
                          }}
                        >
                            <input 
                              type="file" 
                              accept="video/mp4,video/webm,video/quicktime" 
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20" 
                              ref={fileInputRef}
                              onChange={handleFileSelect}
                            />
                            
                            {!video ? (
                                <div className="text-center p-6 transition-opacity duration-300">
                                    <div className="w-16 h-16 bg-orange-100 text-orange-500 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                                        <Icons.Upload />
                                    </div>
                                    <p className="text-stone-600 font-medium text-lg">点击浏览 或 拖拽上传视频</p>
                                    <p className="text-stone-400 text-sm mt-2">支持 MP4, WebM, MOV</p>
                                </div>
                            ) : (
                                <div className={`absolute inset-0 z-30 bg-black flex flex-col items-center justify-center w-full h-full transition-all duration-300 ${isFullscreen ? 'fixed z-[100] w-screen h-screen' : ''}`}>
                                    <video src={video.previewUrl} className="w-full h-full object-contain" controls playsInline />
                                    
                                    <div className="absolute top-0 left-0 w-full p-2 bg-gradient-to-b from-black/70 to-transparent flex justify-between items-start z-20">
                                        <span className="text-white text-xs px-2 py-1 truncate max-w-[50%] opacity-80 font-mono">{video.file.name}</span>
                                        
                                        <div className="flex gap-2">
                                            <button 
                                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsFullscreen(!isFullscreen); }}
                                              className="bg-black/50 hover:bg-blue-600 text-white p-2 rounded-full backdrop-blur-sm transition pointer-events-auto cursor-pointer group w-8 h-8 flex items-center justify-center" 
                                              title="网页全屏"
                                            >
                                                {isFullscreen ? <Icons.Compress /> : <Icons.Expand />}
                                            </button>

                                            <button 
                                              onClick={removeVideo}
                                              className="bg-black/50 hover:bg-red-600 text-white p-2 rounded-full backdrop-blur-sm transition pointer-events-auto cursor-pointer w-8 h-8 flex items-center justify-center" 
                                              title="删除视频"
                                            >
                                                <Icons.Close />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    
                    {/* Action Buttons */}
                    <div className="space-y-3 pt-4 border-t border-stone-100 mt-2">
                        {!analysis.isAnalyzing && (
                            <div className="flex">
                                <button 
                                  onClick={runAnalysis} 
                                  disabled={!video}
                                  className={`flex-1 font-bold py-3 px-4 rounded-xl transition duration-200 flex items-center justify-center shadow-lg group ${!video ? 'bg-stone-300 cursor-not-allowed text-stone-500' : 'bg-gradient-to-r from-stone-800 to-stone-900 hover:from-orange-600 hover:to-orange-700 text-white shadow-orange-500/10'}`}
                                >
                                    <span className="mr-2 group-hover:scale-110 transition-transform"><Icons.Sparkles /></span> AI 视频深度拆解
                                </button>
                            </div>
                        )}

                        {/* Progress Bar Section */}
                        {analysis.isAnalyzing && (
                            <div className="transition-all duration-300 ease-in-out">
                                <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 shadow-inner">
                                    <div className="flex justify-between text-xs text-stone-500 mb-2 font-mono">
                                        <span className="flex items-center gap-1">
                                            <svg className="animate-spin h-3 w-3 text-orange-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            正在初始化...
                                        </span>
                                        <span className="font-bold text-orange-600">{Math.floor(analysis.progress)}%</span>
                                    </div>
                                    
                                    <div className="h-2.5 bg-stone-200 rounded-full overflow-hidden">
                                        <div 
                                          className="h-full bg-gradient-to-r from-orange-400 to-orange-600 transition-all duration-300 ease-out relative"
                                          style={{ width: `${analysis.progress}%` }}
                                        >
                                            <div className="absolute inset-0 bg-white/30 w-full h-full animate-[shimmer_1s_infinite]" style={{backgroundImage: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)', backgroundSize: '50% 100%', backgroundRepeat: 'no-repeat'}}></div>
                                        </div>
                                    </div>
                                    
                                    <div className="text-center mt-3">
                                        <span className="text-xs text-stone-400">{loadingText}</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Meta Analysis Card */}
                <div className="bg-white rounded-2xl shadow-lg border-l-4 border-orange-500 relative overflow-hidden transition-all duration-500 w-full min-h-[300px]">
                    <div className="flex flex-col md:flex-row h-full">
                        
                        {/* Left Column: Core Topic */}
                        <div className="p-6 md:w-2/3 flex flex-col justify-center border-b md:border-b-0 md:border-r border-stone-100 bg-gradient-to-br from-white to-orange-50/30">
                            <div className="flex items-center text-orange-600 mb-4 font-bold text-sm tracking-wide">
                                <span className="mr-2"><Icons.Sparkles /></span>
                                AI 反推核心选题
                            </div>
                            
                            <div className="text-3xl font-black text-stone-800 leading-tight">
                                {analysis.metaData?.topic ? (
                                   <>
                                      <span className="text-4xl text-orange-400 align-top font-serif">“</span>
                                      {analysis.metaData.topic}
                                      <span className="text-4xl text-orange-400 align-bottom font-serif">”</span>
                                   </>
                                ) : (
                                  <span className="text-stone-300 font-normal italic text-lg block py-8">
                                    {analysis.isAnalyzing ? <span className="text-orange-500 animate-pulse text-xl">正在运用算法生成...</span> : "等待视频分析..."}
                                  </span>
                                )}
                            </div>
                        </div>

                        {/* Right Column: Aux Info */}
                        <div className="p-6 md:w-1/3 flex flex-col gap-6 bg-stone-50">
                            
                            {/* 1. Viral Tags */}
                            <div>
                                <div className="text-xs font-bold text-blue-500 uppercase mb-2 flex items-center">
                                    <span className="mr-1"><Icons.Star /></span> 爆款流量标签
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {analysis.metaData?.viral_tags ? (
                                      analysis.metaData.viral_tags.map((tag, i) => (
                                        <span key={i} className="bg-blue-600 text-white px-3 py-1 rounded-full text-xs font-bold shadow-md flex items-center gap-1 hover:bg-blue-700 transition">
                                            <i className="fas fa-star text-[10px] text-yellow-300"></i> {tag}
                                        </span>
                                      ))
                                    ) : (
                                      <span className={`bg-blue-100 text-blue-600 px-2.5 py-1 rounded-full text-xs font-bold shadow-sm ${analysis.isAnalyzing ? 'animate-pulse' : ''}`}>
                                        #待分析
                                      </span>
                                    )}
                                </div>
                            </div>

                            {/* 2. Target Audience */}
                            <div>
                                <div className="text-xs font-bold text-stone-400 uppercase mb-2 flex items-center">
                                    <span className="mr-1"><Icons.User /></span> 目标人群
                                </div>
                                <div className="flex flex-col gap-2">
                                  {analysis.metaData?.audience ? (
                                     analysis.metaData.audience.map((person, i) => {
                                        const parts = person.split(/[:：]/);
                                        return (
                                          <div key={i} className="flex items-start text-xs text-stone-600">
                                              <i className="fas fa-user text-stone-400 mt-0.5 mr-2 text-[10px]"></i>
                                              {parts.length > 1 ? (
                                                 <span><strong className="text-stone-800">{parts[0]}</strong>：{parts[1]}</span>
                                              ) : (
                                                 <span>{person}</span>
                                              )}
                                          </div>
                                        )
                                     })
                                  ) : (
                                    <div className={`text-xs text-stone-400 italic pl-1 ${analysis.isAnalyzing ? 'text-orange-500 animate-pulse' : ''}`}>
                                      {analysis.isAnalyzing ? '分析中...' : '等待人群定位...'}
                                    </div>
                                  )}
                                </div>
                            </div>

                            {/* 3. Theme Tags */}
                            <div>
                                <div className="text-xs font-bold text-stone-400 uppercase mb-2">领域与认知</div>
                                <div className="flex flex-wrap gap-2">
                                  {analysis.metaData?.tags ? (
                                    analysis.metaData.tags.map((tag, i) => (
                                      <span key={i} className="bg-stone-200 text-stone-600 px-2.5 py-1 rounded-full text-xs font-medium border border-stone-300/50 hover:bg-stone-300 transition">#{tag}</span>
                                    ))
                                  ) : (
                                    <span className={`bg-stone-200 text-stone-400 px-2 py-1 rounded text-xs ${analysis.isAnalyzing ? 'animate-pulse' : ''}`}>
                                      #等待识别
                                    </span>
                                  )}
                                </div>
                            </div>

                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom Section: Output */}
            <div className="bg-stone-900 p-6 rounded-2xl shadow-lg border border-stone-800 text-stone-300 flex flex-col h-[600px] relative overflow-hidden">
                <div className="flex justify-between items-center mb-3">
                    <label className="block text-base font-bold text-orange-400 flex items-center">
                        <span className="bg-orange-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs mr-2">2</span>
                        <span>AI 分析报告</span>
                    </label>
                    <div className="flex gap-2">
                        <button 
                          onClick={() => setAnalysis(prev => ({ ...prev, resultHtml: null, metaData: null, error: null }))}
                          className="text-xs bg-stone-800 hover:bg-stone-700 text-stone-400 px-3 py-1.5 rounded-lg transition border border-stone-700"
                        >
                            清空
                        </button>
                        <button 
                          onClick={copyOutput}
                          className="text-xs bg-stone-700 hover:bg-stone-600 text-white px-3 py-1.5 rounded-lg transition border border-stone-600 hover:border-stone-500 flex items-center"
                        >
                            <span className="mr-1"><Icons.Copy /></span> 复制
                        </button>
                    </div>
                </div>
                <div className="relative flex-grow bg-stone-800/50 border border-stone-700 rounded-xl overflow-hidden">
                    <div id="aiOutput" className="w-full h-full overflow-y-auto p-4 text-sm text-stone-200 leading-relaxed">
                        {analysis.resultHtml ? (
                          <div className="report-fade-in" dangerouslySetInnerHTML={{ __html: analysis.resultHtml }} />
                        ) : analysis.error ? (
                          <div className="flex flex-col items-center justify-center h-full text-red-400 space-y-4">
                             <p>❌ {analysis.error}</p>
                          </div>
                        ) : (
                           <div className="flex flex-col items-center justify-center h-full text-stone-500 space-y-4">
                              <div className="w-16 h-16 bg-stone-800 rounded-full flex items-center justify-center">
                                  <div className="text-stone-600 text-2xl"><Icons.Sparkles /></div>
                              </div>
                              <div className="text-center">
                                  <p className="font-medium mb-1">等待 AI 分析...</p>
                                  <p className="text-xs max-w-[200px] opacity-70">点击上方“AI 视频深度拆解”按钮，生成可视化数据报告。</p>
                              </div>
                          </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
      </main>

      {/* Settings Modal */}
      {settingsModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-auto transform transition-all overflow-hidden">
            <div className="bg-stone-50 px-6 py-4 border-b border-stone-200 flex justify-between items-center">
              <h3 className="text-lg font-bold text-stone-800 flex items-center gap-2">
                <span className="bg-orange-100 text-orange-600 p-1.5 rounded-lg"><Icons.Settings /></span>
                API 服务配置
              </h3>
              <button onClick={toggleSettings} className="text-stone-400 hover:text-stone-600 transition p-1 hover:bg-stone-100 rounded-full">
                <Icons.Close />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Provider Selection */}
              <div>
                <label className="block text-xs font-bold text-stone-500 uppercase tracking-wide mb-2">服务商 (AI Provider)</label>
                <div className="flex bg-stone-100 p-1 rounded-lg">
                  <button 
                    onClick={() => setActiveProvider('openai')}
                    className={`flex-1 py-2 px-3 text-sm rounded-md transition-all ${activeProvider === 'openai' ? 'shadow-sm bg-white text-blue-600 font-semibold border border-stone-200' : 'text-stone-500 font-medium hover:text-stone-700'}`}
                  >
                    OpenAI / 兼容接口
                  </button>
                  <button 
                    onClick={() => setActiveProvider('gemini')}
                    className={`flex-1 py-2 px-3 text-sm rounded-md transition-all ${activeProvider === 'gemini' ? 'shadow-sm bg-white text-orange-600 font-semibold border border-stone-200' : 'text-stone-500 font-medium hover:text-stone-700'}`}
                  >
                    Google Gemini
                  </button>
                </div>
              </div>

              {/* Model */}
              <div>
                <label className="block text-xs font-bold text-stone-500 uppercase tracking-wide mb-2">模型 (Model Name)</label>
                <input 
                  type="text" 
                  list="model-suggestions"
                  placeholder="gemini-2.5-flash"
                  value={tempSettings.model}
                  onChange={(e) => setTempSettings({...tempSettings, model: e.target.value})}
                  className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition font-mono text-stone-700"
                />
                <datalist id="model-suggestions">
                    <option value="gemini-2.5-flash" />
                    <option value="gemini-2.5-pro" />
                    <option value="gemini-2.5-flash-thinking" />
                    <option value="gemini-3-flash-preview" />
                    <option value="gpt-4o" />
                    <option value="gpt-4o-mini" />
                    <option value="deepseek-chat" />
                </datalist>
              </div>

              {/* Base URL */}
              <div>
                <label className="block text-xs font-bold text-stone-500 uppercase tracking-wide mb-2">API 地址 (Base URL)</label>
                <input 
                  type="text" 
                  value={tempSettings.baseUrl}
                  onChange={(e) => setTempSettings({...tempSettings, baseUrl: e.target.value})}
                  className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition text-stone-700"
                />
                <p className="text-xs text-stone-400 mt-1.5 ml-1">默认: {DEFAULT_SETTINGS[activeProvider].baseUrl}</p>
              </div>

              {/* API Key */}
              <div>
                <label className="block text-xs font-bold text-stone-500 uppercase tracking-wide mb-2">API Key</label>
                <input 
                  type="password" 
                  placeholder="sk-..."
                  value={tempSettings.apiKey}
                  onChange={(e) => setTempSettings({...tempSettings, apiKey: e.target.value})}
                  className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition font-mono"
                />
              </div>
            </div>

            <div className="bg-stone-50 px-6 py-4 border-t border-stone-200 flex justify-end gap-3">
              <button onClick={toggleSettings} className="px-4 py-2 text-sm font-medium text-stone-600 hover:text-stone-800 hover:bg-stone-200 rounded-lg transition">
                取消
              </button>
              <button onClick={saveSettings} className="px-6 py-2 text-sm font-bold text-white bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 rounded-lg shadow-md transition transform hover:scale-[1.02]">
                保存配置
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="bg-white border-t border-stone-200 py-6 text-center text-sm text-stone-500 mt-auto">
        <p>&copy; 2024 AI 爆款视频拆解助手 | Powered by Gemini & OpenAI Protocols</p>
      </footer>
    </div>
  );
}