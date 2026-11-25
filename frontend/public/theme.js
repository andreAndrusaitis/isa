try {
  var t = localStorage.getItem('isa-theme')
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t)
} catch (e) { /* sem armazenamento */ }
