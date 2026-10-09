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
      'padding:28px 24px', 'width:min(380px, calc(100vw - 32px))',
      'box-shadow:0 20px 50px rgba(0,0,0,0.5)', 'box-sizing:border-box',
      'text-align:center'
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

    // Email input
    var input = document.createElement('input');
    input.type = 'email';
    input.placeholder = 'your@email.com';
    input.id = 'swr-ea-email';
    input.style.cssText = [
      'width:100%', 'padding:12px 14px', 'border:1px solid #3f3f46',
      'border-radius:8px', 'background:#1c1c24', 'color:#fff', 'font-size:15px',
      'box-sizing:border-box', 'margin-bottom:12px', 'outline:none',
      'transition:border-color 0.2s'
    ].join(';');
    input.addEventListener('focus', function() { input.style.borderColor = '#f5a623'; });
    input.addEventListener('blur', function() { input.style.borderColor = '#3f3f46'; });

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

    card.appendChild(close);
    card.appendChild(icon);
    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(input);
    card.appendChild(btn);
    card.appendChild(msg);
    host.appendChild(card);
    document.body.appendChild(host);

    // Submit handler
    btn.addEventListener('click', function() { submit(input, btn, msg); });
    input.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') submit(input, btn, msg);
    });

    STATE.els = { host, input, btn, msg };
    STATE.mounted = true;
    return STATE.els;
  }

  async function submit(input, btn, msg) {
    var email = input.value.trim();
    
    // Basic validation
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      msg.textContent = 'Please enter a valid email';
      msg.style.color = '#ef4444';
      return;
    }

    // Disable button during request
    btn.disabled = true;
    btn.textContent = 'Sending...';
    btn.style.opacity = '0.7';
    msg.textContent = '';
    input.disabled = true;

    try {
      var res = await fetch('/api/early-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      });
      
      var data = await res.json();
      
      if (res.ok && data.ok) {
        msg.textContent = data.message || 'You\'re on the list!';
        msg.style.color = '#22c55e';
        btn.textContent = 'Joined!';
        btn.style.background = '#22c55e';
        // Auto-hide after success
        setTimeout(hide, 2000);
      } else {
        msg.textContent = data.error || 'Something went wrong';
        msg.style.color = '#ef4444';
        btn.disabled = false;
        btn.textContent = 'Join the List';
        btn.style.opacity = '1';
        input.disabled = false;
      }
    } catch (e) {
      msg.textContent = 'Network error. Please try again.';
      msg.style.color = '#ef4444';
      btn.disabled = false;
      btn.textContent = 'Join the List';
      btn.style.opacity = '1';
      input.disabled = false;
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
    STATE.els.input.value = '';
    STATE.els.input.disabled = false;
    STATE.els.btn.disabled = false;
    STATE.els.btn.textContent = 'Join the List';
    STATE.els.btn.style.opacity = '1';
    STATE.els.btn.style.background = 'linear-gradient(135deg, #f5a623 0%, #e88d1a 100%)';
    STATE.els.msg.textContent = '';
  }

  window.SWR_EARLY_ACCESS = { show, hide };
})();
