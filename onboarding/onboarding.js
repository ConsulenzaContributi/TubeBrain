const $ = id => document.getElementById(id);

let currentStep = 1;
let selectedEngine = 'gemini';
let useFolder = false;

document.addEventListener('DOMContentLoaded', async () => {
  // Navigation
  $('btn-next-1').addEventListener('click', () => goStep(2));
  $('btn-skip').addEventListener('click', () => finish(false));
  
  // Engine Selection
  document.querySelectorAll('.engine-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.engine-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      selectedEngine = card.dataset.engine;
    });
  });
  
  $('btn-next-2').addEventListener('click', () => {
    // Aggiorna interfaccia step 3 in base al motore
    const subtitle = $('api-subtitle');
    const guideList = $('api-guide-list');
    
    if (selectedEngine === 'gemini') {
      subtitle.textContent = 'Collega il tuo account Google AI Studio.';
      guideList.innerHTML = `
        <li>Vai su <a href="https://aistudio.google.com/app/apikey" target="_blank">Google AI Studio</a></li>
        <li>Clicca su "Create API Key"</li>
        <li>Copia la chiave (inizia con <code>AIzaSy...</code>) e incollala qui</li>
      `;
    } else {
      subtitle.textContent = 'Collega il tuo account OpenAI Developer.';
      guideList.innerHTML = `
        <li>Vai su <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI API Dashboard</a></li>
        <li>Clicca su "Create new secret key"</li>
        <li>Copia la chiave (inizia con <code>sk-...</code>) e incollala qui</li>
      `;
    }
    
    goStep(3);
  });
  
  // API Key
  const apiInput = $('api-key-input');
  const btnNext3 = $('btn-next-3');
  const feedback = $('api-feedback');
  
  apiInput.addEventListener('input', () => {
    const val = apiInput.value.trim();
    if (val.length > 20) {
      btnNext3.disabled = false;
      feedback.textContent = '';
    } else {
      btnNext3.disabled = true;
    }
  });
  
  $('btn-test-key').addEventListener('click', () => {
    const val = apiInput.value.trim();
    if (selectedEngine === 'gemini' && !val.startsWith('AIzaSy')) {
      feedback.style.color = '#fa5252';
      feedback.textContent = '❌ Sembra che la chiave Gemini sia errata (deve iniziare con AIzaSy).';
      return;
    }
    if (selectedEngine === 'openai' && !val.startsWith('sk-')) {
      feedback.style.color = '#fa5252';
      feedback.textContent = '❌ Sembra che la chiave OpenAI sia errata (deve iniziare con sk-).';
      return;
    }
    feedback.style.color = '#40c057';
    feedback.textContent = '✅ Formato chiave corretto!';
    btnNext3.disabled = false;
  });
  
  btnNext3.addEventListener('click', async () => {
    const apiKey = apiInput.value.trim();
    // Salva nel db locale via background script message
    const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
    const settings = resp.settings || {};
    
    settings.provider = selectedEngine;
    if (selectedEngine === 'gemini') settings.geminiApiKey = apiKey;
    if (selectedEngine === 'openai') settings.openaiApiKey = apiKey;
    
    await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings });
    goStep(4);
  });
  
  // Folder
  $('btn-pick-folder').addEventListener('click', async () => {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await FileSystemUtils.saveHandle(handle);
      useFolder = true;
      $('folder-feedback').style.color = '#40c057';
      $('folder-feedback').textContent = '✅ Cartella selezionata: ' + handle.name;
    } catch (e) {
      if (e.name !== 'AbortError') {
        $('folder-feedback').style.color = '#fa5252';
        $('folder-feedback').textContent = 'Errore: ' + e.message;
      }
    }
  });
  
  $('btn-next-4').addEventListener('click', () => goStep(5));
  
  // Strategy & Finish
  $('btn-finish').addEventListener('click', () => finish(useFolder));
  
  // Back buttons
  document.querySelectorAll('.btn-back').forEach(btn => {
    btn.addEventListener('click', () => goStep(currentStep - 1));
  });
});

function goStep(step) {
  document.querySelectorAll('.step-card').forEach(c => c.classList.remove('active'));
  $(`step-${step}`).classList.add('active');
  currentStep = step;
}

async function finish(useFolderApi) {
  const strategyInput = document.querySelector('input[name="archive_strategy"]:checked');
  const archiveStrategy = strategyInput ? strategyInput.value : 'author-first';
  
  const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
  const settings = resp.settings || {};
  
  await chrome.runtime.sendMessage({ action: 'SAVE_SETTINGS', settings: {
    ...settings,
    onboardingCompleted: true,
    useFileSystemApi: useFolderApi,
    archiveStrategy: archiveStrategy
  }});
  
  alert("Setup Completato! Ora puoi aprire TubeBrain mentre guardi un video su YouTube.");
  window.close();
}
