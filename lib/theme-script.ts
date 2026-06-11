/** 在首屏绘制前应用主题，避免 dark/light 闪烁。与 ThemeProvider 共用 localStorage key。 */
export const THEME_INIT_SCRIPT = `(function(){try{var k='theme',t=localStorage.getItem(k)||'system',r=t;if(t==='system'){r=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}var e=document.documentElement;e.classList.remove('light','dark');e.classList.add(r);e.style.colorScheme=r;}catch(x){}})();`
