(function () {
  function initLightbox() {
    var overlay = document.createElement('div');
    overlay.id = 'lb-overlay';
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(0,0,0,0.88)',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '9000',
    });

    var img = document.createElement('img');
    img.id = 'lb-img';
    Object.assign(img.style, {
      maxWidth: '90vw',
      maxHeight: '88vh',
      objectFit: 'contain',
      borderRadius: '8px',
      boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
    });

    var closeBtn = document.createElement('button');
    closeBtn.id = 'lb-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close image');
    Object.assign(closeBtn.style, {
      position: 'absolute',
      top: '16px',
      right: '20px',
      background: 'none',
      border: 'none',
      color: 'white',
      fontSize: '40px',
      cursor: 'pointer',
      lineHeight: '1',
    });

    overlay.appendChild(closeBtn);
    overlay.appendChild(img);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target === closeBtn) closeLb();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeLb();
    });

    document.querySelectorAll('.lb-trigger').forEach(function (el) {
      el.style.cursor = 'zoom-in';
      el.addEventListener('click', function () {
        img.src = el.getAttribute('data-full') || el.src;
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
      });
    });

    function closeLb() {
      overlay.style.display = 'none';
      img.src = '';
      document.body.style.overflow = '';
    }
  }

  document.addEventListener('DOMContentLoaded', initLightbox);
})();
