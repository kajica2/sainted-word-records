// lib/early-access-modal.client.js — Early access request modal.
//
// A plain-DOM modal for requesting early access to the platform.
//
// API:
//   window.SWR_EARLY_ACCESS.show();    // open modal
//   window.SWR_EARLY_ACCESS.hide();   // close modal
//
// Usage: Add to any page with:
//   <script src="/lib/early-access-modal.client.js" defer></script>
//   <button onclick="SWR_EARLY_ACCESS.show()">Request Early Access</button>

(function () {
  if (window.SWR_EARLY_ACCESS) return;

  var STATE = {
    mounted: false,
    els: null,
    visible: false
  };

  function build() {
    if (STATE.mounted) return STATE.els;

    var host = document.createElement('div');
    host.id = 'swr-ea-modal-host';
    host.style.cssText = [
      'position:fixed', 'inset:0', 'display:none',
      'align-items:center', 'justify-content:center',
      'background:rgba(0,0,0,0.6)',
      'z-index:9999',
      'font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      'color:#fff'
    ].join(';');

    var card = document.createElement('div');
    card.className = 'swr-ea-card';
    card.style.cssText = [
      'background:#14141a', 'border:1px solid #2a2a35', 'border-radius:12px',
      'padding:28px 24px', 'width:min(420px, calc(100vw - 32px))',
      'box-shadow:0 20px 50px rgba(0,0,0,0.5)', 'box-sizing:border-box',
      'text-align:center', 'max-height:90vh', 'overflow-y:auto'
    ].join(';');

    // Icon
    var icon = document.createElement('div');
    icon.innerHTML = '★';
    icon.style.cssText = 'font-size:32px; color:#f5a623; margin-bottom:12px;';

    // Title
    var title = document.createElement('h2');
    title.textContent = 'Request Early Access';
    title.style.cssText = 'margin:0 0 8px;font-size:20px;font-weight:600;';

    // Description
    var desc = document.createElement('p');
    desc.textContent = 'Be the first to try new features before they\'re publicly available.';
    desc.style.cssText = 'margin:0 0 20px;font-size:14px;color:#9ca3af;line-height:1.5;';

    // Name input (optional)
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Your name (optional)';
    nameInput.id = 'swr-ea-name';
    nameInput.style.cssText = [
      'width:100%', 'padding:12px 14px', 'border:1px solid #3f3f46',
      'border-radius:8px', 'background:#1c1c24', 'color:#fff', 'font-size:15px',
      'box-sizing:border-box', 'margin-bottom:12px', 'outline:none',
      'transition:border-color 0.2s'
    ].join(';');
    nameInput.addEventListener('focus', function() { nameInput.style.borderColor = '#f5a623'; });
    nameInput.addEventListener('blur', function() { nameInput.style.borderColor = '#3f3f46'; });

    // Email input (required)
    var emailInput = document.createElement('input');
    emailInput.type = 'email';
    emailInput.placeholder = 'your@email.com';
    emailInput.id = 'swr-ea-email';
    emailInput.required = true;
    emailInput.style.cssText = [
      'width:100%', 'padding:12px 14px', 'border:1px solid #3f3f46',
      'border-radius:8px', 'background:#1c1c24', 'color:#fff', 'font-size:15px',
      'box-sizing:border-box', 'margin-bottom:12px', 'outline:none',
      'transition:border-color 0.2s'
    ].join(';');
    emailInput.addEventListener('focus', function() { emailInput.style.borderColor = '#f5a623'; });
    emailInput.addEventListener('blur', function() { emailInput.style.borderColor = '#3f3f46'; });

    // Use case dropdown
    var useCaseLabel = document.createElement('label');
    useCaseLabel.textContent = 'What describes you best?';
    useCaseLabel.style.cssText = 'display:block;text-align:left;font-size:13px;color:#9ca3af;margin-bottom:6px;';

    var useCaseSelect = document.createElement('select');
    useCaseSelect.id = 'swr-ea-usecase';
    useCaseSelect.style.cssText = [
      'width:100%', 'padding:12px 14px', 'border:1px solid #3f3f46',
      'border-radius:8px', 'background:#1c1c24', 'color:#fff', 'font-size:15px',
      'box-sizing:border-box', 'margin-bottom:16px', 'outline:none', 'cursor:pointer',
      'transition:border-color 0.2s'
    ].join(';');
    useCaseSelect.innerHTML = [
      '<option value="" disabled selected>Select your use case</option>',
      '<option value="personal">Just exploring for personal projects</option>',
      '<option value="creator">Content creator / musician</option>',
      '<option value="label">Record label / music company</option>',
      '<option value="company">Company / team use</option>'
    ].join('');
    useCaseSelect.addEventListener('focus', function() { useCaseSelect.style.borderColor = '#f5a623'; });
    useCaseSelect.addEventListener('blur', function() { useCaseSelect.style.borderColor = '#3f3f46'; });
    useCaseSelect.addEventListener('change', function() {
      // Show/hide company-specific field based on selection
      var coField = document.getElementById('swr-ea-company-field');
      if (useCaseSelect.value === 'company') {
        if (coField) coField.style.display = 'block';
      } else {
        if (coField) coField.style.display = 'none';
      }
    });

    // Company size field (shown only when "Company" is selected)
    var companyField = document.createElement('div');
    companyField.id = 'swr-ea-company-field';
    companyField.style.cssText = 'display:none;margin-bottom:16px;';

    var companyLabel = document.createElement('label');
    companyLabel.textContent = 'Company size';
    companyLabel.style.cssText = 'display:block;text-align:left;font-size:13px;color:#9ca3af;margin-bottom:6px;';

    var companySelect = document.createElement('select');
    companySelect.id = 'swr-ea-company-size';
    companySelect.style.cssText = [
      'width:100%', 'padding:12px 14px', 'border:1px solid #3f3f46',
      'border-radius:8px', 'background:#1c1c24', 'color:#fff', 'font-size:15px',
      'box-sizing:border-box', 'outline:none', 'cursor:pointer'
    ].join(';');
    companySelect.innerHTML = [
      '<option value="1-10">1-10 employees</option>',
      '<option value="11-50">11-50 employees</option>',
      '<option value="51-200">51-200 employees</option>',
      '<option value="200+">200+ employees</option>'
    ].join('');
    companyField.appendChild(companyLabel);
    companyField.appendChild(companySelect);

    // Agreement checkbox
    var agreeLabel = document.createElement('label');
    agreeLabel.style.cssText = 'display:flex;align-items:flex-start;gap:10px;cursor:pointer;margin-bottom:20px;text-align:left;';

    var agreeCheckbox = document.createElement('input');
    agreeCheckbox.type = 'checkbox';
    agreeCheckbox.id = 'swr-ea-agree';
    agreeCheckbox.required = true;
    agreeCheckbox.style.cssText = 'margin-top:3px;flex-shrink:0;';

    var agreeText = document.createElement('span');
    agreeText.innerHTML = 'I agree to the <a href="/legal/beta-test.html" target="_blank" style="color:#f5a623;">Beta Test Agreement</a>. I understand this is pre-release software provided "as-is" without warranties.';
    agreeText.style.cssText = 'font-size:12px;color:#9ca3af;line-height:1.4;';

    agreeLabel.appendChild(agreeCheckbox);
    agreeLabel.appendChild(agreeText);

    // Submit button
    var btn = document.createElement('button');
    btn.id = 'swr-ea-submit';
    btn.textContent = 'Join the List';
    btn.style.cssText = [
      'width:100%', 'padding:12px', 'border:none', 'border-radius:8px',
      'background:linear-gradient(135deg, #f5a623 0%, #e88d1a 100%)',
      'color:#14141a', 'font-size:15px', 'font-weight:600', 'cursor:pointer',
      'transition:opacity 0.2s, transform 0.1s'
    ].join(';');
    btn.addEventListener('mouseenter', function() { btn.style.opacity = '0.9'; });
    btn.addEventListener('mouseleave', function() { btn.style.opacity = '1'; });
    btn.addEventListener('mousedown', function() { btn.style.transform = 'scale(0.98)'; });
    btn.addEventListener('mouseup', function() { btn.style.transform = 'scale(1)'; });

    // Message area
    var msg = document.createElement('div');
    msg.id = 'swr-ea-msg';
    msg.style.cssText = 'margin-top:16px;font-size:13px;min-height:20px;';

    // Close button
    var close = document.createElement('button');
    close.innerHTML = '×';
    close.title = 'Close';
    close.style.cssText = [
      'position:absolute', 'top:12px', 'right:12px', 'background:none',
      'border:none', 'color:#6b7280', 'font-size:24px', 'cursor:pointer',
      'line-height:1', 'padding:4px'
    ].join(';');
    close.addEventListener('click', hide);
    close.addEventListener('mouseenter', function() { close.style.color = '#fff'; });
    close.addEventListener('mouseleave', function() { close.style.color = '#6b7280'; });

    // Backdrop click to close
    host.addEventListener('click', function(e) {
      if (e.target === host) hide();
    });

    // Escape key to close
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && STATE.visible) hide();
    });

    // Assemble card
    card.appendChild(close);
    card.appendChild(icon);
    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(nameInput);
    card.appendChild(emailInput);
    card.appendChild(useCaseLabel);
    card.appendChild(useCaseSelect);
    card.appendChild(companyField);
    card.appendChild(agreeLabel);
    card.appendChild(btn);
    card.appendChild(msg);
    host.appendChild(card);
    document.body.appendChild(host);

    // Submit handler
    btn.addEventListener('click', function() {
      submit(emailInput, nameInput, useCaseSelect, companySelect, agreeCheckbox, btn, msg);
    });
    emailInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') submit(emailInput, nameInput, useCaseSelect, companySelect, agreeCheckbox, btn, msg);
    });

    STATE.els = { host, emailInput, nameInput, useCaseSelect, companySelect, agreeCheckbox, btn, msg };
    STATE.mounted = true;
    return STATE.els;
  }

  async function submit(emailInput, nameInput, useCaseSelect, companySelect, agreeCheckbox, btn, msg) {
    var email = emailInput.value.trim();
    var name = nameInput.value.trim();
    var useCase = useCaseSelect.value;
    var agreed = agreeCheckbox.checked;
    
    // Validation
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      msg.textContent = 'Please enter a valid email';
      msg.style.color = '#ef4444';
      return;
    }

    if (!useCase) {
      msg.textContent = 'Please select your use case';
      msg.style.color = '#ef4444';
      return;
    }

    if (!agreed) {
      msg.textContent = 'Please accept the Beta Test Agreement';
      msg.style.color = '#ef4444';
      return;
    }

    // Build payload
    var payload = {
      email: email,
      name: name || undefined,
      useCase: useCase,
      agreed: true
    };

    // Add company size if company selected
    if (useCase === 'company' && companySelect.value) {
      payload.companySize = companySelect.value;
    }

    // Disable button during request
    btn.disabled = true;
    btn.textContent = 'Sending...';
    btn.style.opacity = '0.7';
    msg.textContent = '';
    emailInput.disabled = true;
    nameInput.disabled = true;
    useCaseSelect.disabled = true;
    agreeCheckbox.disabled = true;

    try {
      var res = await fetch('/api/early-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      var data = await res.json();
      
      if (res.ok && data.ok) {
        msg.textContent = data.message || 'You\'re on the list!';
        msg.style.color = '#22c55e';
        btn.textContent = 'Joined!';
        btn.style.background = '#22c55e';
        // Auto-hide after success
        setTimeout(hide, 2500);
      } else {
        msg.textContent = data.error || 'Something went wrong';
        msg.style.color = '#ef4444';
        btn.disabled = false;
        btn.textContent = 'Join the List';
        btn.style.opacity = '1';
        emailInput.disabled = false;
        nameInput.disabled = false;
        useCaseSelect.disabled = false;
        agreeCheckbox.disabled = false;
      }
    } catch (e) {
      msg.textContent = 'Network error. Please try again.';
      msg.style.color = '#ef4444';
      btn.disabled = false;
      btn.textContent = 'Join the List';
      btn.style.opacity = '1';
      emailInput.disabled = false;
      nameInput.disabled = false;
      useCaseSelect.disabled = false;
      agreeCheckbox.disabled = false;
    }
  }

  function show() {
    var els = build();
    els.host.style.display = 'flex';
    els.input.focus();
    STATE.visible = true;
  }

  function hide() {
    if (!STATE.mounted) return;
    STATE.els.host.style.display = 'none';
    STATE.visible = false;
    // Reset form
    STATE.els.emailInput.value = '';
    STATE.els.emailInput.disabled = false;
    STATE.els.nameInput.value = '';
    STATE.els.nameInput.disabled = false;
    STATE.els.useCaseSelect.value = '';
    STATE.els.useCaseSelect.disabled = false;
    STATE.els.agreeCheckbox.checked = false;
    STATE.els.agreeCheckbox.disabled = false;
    // Hide company field
    var coField = document.getElementById('swr-ea-company-field');
    if (coField) coField.style.display = 'none';
    // Reset button
    STATE.els.btn.disabled = false;
    STATE.els.btn.textContent = 'Join the List';
    STATE.els.btn.style.opacity = '1';
    STATE.els.btn.style.background = 'linear-gradient(135deg, #f5a623 0%, #e88d1a 100%)';
    STATE.els.msg.textContent = '';
  }

  window.SWR_EARLY_ACCESS = { show, hide };
})();
