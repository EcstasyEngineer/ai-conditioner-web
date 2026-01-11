"use client";

import { useState, useEffect, useCallback } from 'react';
import { Play, Download, Eye, EyeOff } from 'lucide-react';
import SpiralViewer from '@/components/ui/spiral-viewer';
import { TemplateProcessor, TEMPLATE_VARIABLES, TTSOptions } from '@/lib/tts/aws-polly';


interface ProcessedVariant {
  text: string;
  variables: string;
  audioHash?: string;
  audioUrl?: string;
}

export default function MantraEditor() {
  const [currentTemplate, setCurrentTemplate] = useState<string>('');
  const [selectedTheme, setSelectedTheme] = useState<string>('');
  const [selectedDifficulty, setSelectedDifficulty] = useState<'BASIC' | 'LIGHT' | 'MODERATE' | 'DEEP' | 'EXTREME'>('LIGHT');
  const [variants, setVariants] = useState<ProcessedVariant[]>([]);
  const [showPreview, setShowPreview] = useState(true);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [ttsOptions, setTtsOptions] = useState<TTSOptions>({
    voiceId: 'Salli',
    engine: 'neural',
    outputFormat: 'mp3'
  });

  const sampleTemplates = [
    "{subject_subjective} [crave|craves] to be a sexy bimbo in shiny heels.",
    "Being a bimbo is {subject_possessive} true bliss.",
    "{subject_subjective} [am|are|are|is] just a sexy bimbo, always ready to please.",
    "{subject_subjective} [love|loves] feeling pretty and empty.",
    "Dressing sexy fills {subject_objective} with pure joy.",
    "{subject_possessive} mind melts to mush, and that feels so right.",
    "{subject_subjective} don't think, {subject_subjective} just feel... deeply."
  ];

  const themes = [
    'Bimbo', 'Obedience', 'Relaxation', 'Mindbreak', 'Submission', 
    'Doll', 'Slave', 'Worship', 'Acceptance', 'Brainwashing'
  ];

  const voiceOptions = [
    'Salli', 'Joanna', 'Kendra', 'Kimberly', 'Amy', 'Emma', 'Brian', 'Justin'
  ];

  const generateVariants = useCallback(() => {
    if (!currentTemplate.trim()) {
      setVariants([]);
      return;
    }

    const newVariants: ProcessedVariant[] = [];

    // Generate variants for different POV and dominant combinations
    const povVariants = [
      { name: 'First Person', vars: TEMPLATE_VARIABLES.FIRST_PERSON },
      { name: 'Second Person', vars: TEMPLATE_VARIABLES.SECOND_PERSON },
      { name: 'Third Person (F)', vars: TEMPLATE_VARIABLES.THIRD_PERSON_FEMININE }
    ];

    const dominants = ['Generic', 'Master', 'Mistress'];

    povVariants.forEach(pov => {
      dominants.forEach(dominant => {
        const variables = {
          ...pov.vars,
          dominant_name: dominant === 'Generic' ? undefined : dominant
        };

        const processedText = TemplateProcessor.processTemplate(currentTemplate, variables);

        newVariants.push({
          text: processedText,
          variables: `${pov.name} + ${dominant}`
        });
      });
    });

    setVariants(newVariants);
  }, [currentTemplate]);

  useEffect(() => {
    if (currentTemplate) {
      generateVariants();
    }
  }, [currentTemplate, generateVariants]);

  const generateAudioForVariants = async () => {
    setIsGeneratingAudio(true);
    
    try {
      // In a real implementation, this would call the TTS service
      console.log('Generating audio for variants with options:', ttsOptions);
      
      // Simulate audio generation
      const updatedVariants = variants.map(variant => ({
        ...variant,
        audioHash: Math.random().toString(36).substring(7),
        audioUrl: `/audio/${Math.random().toString(36).substring(7)}.mp3`
      }));
      
      setVariants(updatedVariants);
      
    } catch (error) {
      console.error('Error generating audio:', error);
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const exportVariants = () => {
    const exportData = {
      template: currentTemplate,
      theme: selectedTheme,
      difficulty: selectedDifficulty,
      variants: variants.map(v => ({
        text: v.text,
        variables: v.variables,
        audioHash: v.audioHash
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedTheme}_${selectedDifficulty}_variants.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadSampleTemplate = (template: string) => {
    setCurrentTemplate(template);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Mantra Editor</h1>
              <p className="text-gray-600">Create and test templated hypnosis content</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={exportVariants}
                disabled={variants.length === 0}
                className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 flex items-center gap-2 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
              <button
                onClick={generateAudioForVariants}
                disabled={variants.length === 0 || isGeneratingAudio}
                className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 flex items-center gap-2 disabled:opacity-50"
              >
                {isGeneratingAudio ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                ) : (
                  <Play className="w-4 h-4" />
                )}
                Generate Audio
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Template Editor */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Template Editor</h2>
            
            {/* Metadata */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Theme</label>
                <select
                  value={selectedTheme}
                  onChange={(e) => setSelectedTheme(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-lg"
                >
                  <option value="">Select theme...</option>
                  {themes.map(theme => (
                    <option key={theme} value={theme}>{theme}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Difficulty</label>
                <select
                  value={selectedDifficulty}
                  onChange={(e) => setSelectedDifficulty(e.target.value as 'BASIC' | 'LIGHT' | 'MODERATE' | 'DEEP' | 'EXTREME')}
                  className="w-full p-2 border border-gray-300 rounded-lg"
                >
                  <option value="BASIC">Basic (10-15pts)</option>
                  <option value="LIGHT">Light (20-30pts)</option>
                  <option value="MODERATE">Moderate (35-45pts)</option>
                  <option value="DEEP">Deep (60-80pts)</option>
                  <option value="EXTREME">Extreme (100-120pts)</option>
                </select>
              </div>
            </div>

            {/* Template Input */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Template Text
                <span className="text-xs text-gray-500 ml-2">
                  Use {`{subject_subjective}`}, {`{subject_objective}`}, {`{subject_possessive}`}, {`[verb|verbs]`}
                </span>
              </label>
              <textarea
                value={currentTemplate}
                onChange={(e) => setCurrentTemplate(e.target.value)}
                placeholder="Enter your mantra template here..."
                className="w-full h-32 p-3 border border-gray-300 rounded-lg resize-none"
              />
            </div>

            {/* Sample Templates */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Sample Templates</label>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {sampleTemplates.map((template, index) => (
                  <button
                    key={index}
                    onClick={() => loadSampleTemplate(template)}
                    className="w-full text-left p-2 text-sm bg-gray-50 hover:bg-gray-100 rounded border"
                  >
                    {template}
                  </button>
                ))}
              </div>
            </div>

            {/* TTS Options */}
            <div className="border-t pt-4">
              <h3 className="text-sm font-medium text-gray-700 mb-3">TTS Options</h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Voice</label>
                  <select
                    value={ttsOptions.voiceId}
                    onChange={(e) => setTtsOptions(prev => ({ ...prev, voiceId: e.target.value }))}
                    className="w-full p-1 text-sm border border-gray-300 rounded"
                  >
                    {voiceOptions.map(voice => (
                      <option key={voice} value={voice}>{voice}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Engine</label>
                  <select
                    value={ttsOptions.engine}
                    onChange={(e) => setTtsOptions(prev => ({ ...prev, engine: e.target.value as 'standard' | 'neural' }))}
                    className="w-full p-1 text-sm border border-gray-300 rounded"
                  >
                    <option value="neural">Neural</option>
                    <option value="standard">Standard</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Format</label>
                  <select
                    value={ttsOptions.outputFormat}
                    onChange={(e) => setTtsOptions(prev => ({ ...prev, outputFormat: e.target.value as 'mp3' }))}
                    className="w-full p-1 text-sm border border-gray-300 rounded"
                  >
                    <option value="mp3">MP3</option>
                    <option value="ogg_vorbis">OGG</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Preview Panel */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Generated Variants</h2>
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="text-gray-600 hover:text-gray-900"
              >
                {showPreview ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>

            {showPreview && (
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {variants.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">
                    Enter a template to see generated variants
                  </p>
                ) : (
                  variants.map((variant, index) => (
                    <div key={index} className="border border-gray-200 rounded-lg p-3">
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-1 rounded">
                          {variant.variables}
                        </span>
                        {variant.audioUrl && (
                          <button className="text-green-600 hover:text-green-700">
                            <Play className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <p className="text-sm text-gray-800">{variant.text}</p>
                      {variant.audioHash && (
                        <p className="text-xs text-gray-500 mt-1">
                          Audio: {variant.audioHash}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Visual Preview */}
        <div className="mt-8 bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Visual Preview</h2>
          <div className="flex justify-center">
            <SpiralViewer 
              shaderName="pink_spiral"
              width={400}
              height={300}
              autoplay={true}
              speed={0.5}
            />
          </div>
        </div>
      </main>
    </div>
  );
}