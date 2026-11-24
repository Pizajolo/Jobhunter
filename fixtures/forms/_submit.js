// Shared mock-form behaviour: validate required fields, then show a confirmation page.
document.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  const missing = [...form.querySelectorAll('[required]')].filter((el) => (el.type === 'checkbox' ? !el.checked : el.type === 'file' ? el.files.length === 0 : !el.value));
  if (missing.length) {
    let err = document.getElementById('errors');
    if (!err) { err = document.createElement('p'); err.id = 'errors'; err.setAttribute('role', 'alert'); form.prepend(err); }
    err.textContent = 'Please fill in all required fields.';
    return;
  }
  const data = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'file') data[el.name] = [...el.files].map((f) => f.name);
    else if (el.type === 'radio' || el.type === 'checkbox') { if (el.checked) data[el.name] = el.value; }
    else data[el.name] = el.value;
  }
  window.__submitted = data;
  document.body.innerHTML = '<main><h1>Thank you for applying!</h1><p>Your application has been received. Reference: APP-4711</p></main>';
});
