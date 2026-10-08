(function(){var t;try{t=localStorage.getItem('theme')}catch(e){}
if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
document.documentElement.dataset.theme=t})();
