document.addEventListener('DOMContentLoaded', () => {
  const loader = document.getElementById('loader-overlay');
  const loaderText = document.querySelector('.loader-text');
  const mobileToggle = document.getElementById('mobile-toggle');
  const navbarMenu = document.getElementById('navbar-menu');

  // Mobile Hamburger Menu Toggle
  if (mobileToggle && navbarMenu) {
    mobileToggle.addEventListener('click', () => {
      navbarMenu.classList.toggle('active');
      mobileToggle.classList.toggle('active');
    });

    // Close mobile menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!mobileToggle.contains(e.target) && !navbarMenu.contains(e.target)) {
        navbarMenu.classList.remove('active');
        mobileToggle.classList.remove('active');
      }
    });
  }

  // Admin Dropdown Menu Toggle (Desktop & Touch)
  const adminTrigger = document.getElementById('admin-menu-trigger');
  const adminDropdown = document.getElementById('admin-dropdown');

  if (adminTrigger && adminDropdown) {
    adminTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      adminDropdown.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
      if (!adminTrigger.contains(e.target) && !adminDropdown.contains(e.target)) {
        adminDropdown.classList.remove('active');
      }
    });
  }

  let loaderSafetyTimer = null;

  // Helper to re-enable any disabled submit buttons
  function reEnableSubmitButtons() {
    document.querySelectorAll('button[type="submit"]:disabled').forEach(btn => {
      btn.disabled = false;
    });
  }

  // Helper to show loader overlay
  window.showLoader = function(message = 'Processing Request...') {
    if (loader) {
      if (loaderText) loaderText.textContent = message;
      loader.classList.add('active');

      // Safety timeout: automatically dismiss loader after 15s to prevent screen hanging
      if (loaderSafetyTimer) clearTimeout(loaderSafetyTimer);
      loaderSafetyTimer = setTimeout(() => {
        window.hideLoader();
      }, 15000);
    }
  };

  // Helper to hide loader overlay and unlock buttons
  window.hideLoader = function() {
    if (loader) {
      loader.classList.remove('active');
    }
    if (loaderSafetyTimer) {
      clearTimeout(loaderSafetyTimer);
      loaderSafetyTimer = null;
    }
    reEnableSubmitButtons();
  };

  // Dismiss loader and restore buttons on browser back/forward navigation or BFCache restoration
  window.addEventListener('pageshow', () => {
    window.hideLoader();
  });

  window.addEventListener('popstate', () => {
    window.hideLoader();
  });

  // Ensure loader is cleared immediately on load
  window.hideLoader();

  // Show loader on form submission (login, create event, user creation, etc.)
  document.querySelectorAll('form').forEach(form => {
    // Re-enable if form validation fails
    form.addEventListener('invalid', () => {
      window.hideLoader();
    }, true);

    form.addEventListener('submit', (e) => {
      // Don't show loader if form has data-no-loader attribute
      if (form.hasAttribute('data-no-loader')) return;

      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
      }

      // Check if uploading images
      const fileInput = form.querySelector('input[type="file"]');
      if (fileInput && fileInput.files && fileInput.files.length > 0) {
        const fileCount = fileInput.files.length;
        window.showLoader(`Uploading & Processing ${fileCount} Image${fileCount > 1 ? 's' : ''} into Database...`);
      } else {
        window.showLoader('Processing Request...');
      }
    });
  });

  // Show loader on links with data-loader attribute
  document.querySelectorAll('a[data-loader="true"]').forEach(link => {
    link.addEventListener('click', () => {
      window.showLoader('Loading Page...');
    });
  });

  // Multi-image file input counter display & validation
  const multiFileInput = document.getElementById('images');
  const fileCountDisplay = document.getElementById('file-count-display');

  if (multiFileInput && fileCountDisplay) {
    multiFileInput.addEventListener('change', () => {
      const count = multiFileInput.files.length;
      const submitBtn = multiFileInput.closest('form')?.querySelector('button[type="submit"]');

      if (count > 150) {
        fileCountDisplay.textContent = `⚠️ Selected ${count} images. Maximum allowed limit is 150 images. Please reduce by ${count - 150}.`;
        fileCountDisplay.style.color = '#000000';
        if (submitBtn) submitBtn.disabled = true;
      } else if (count > 0) {
        fileCountDisplay.textContent = `✓ Selected ${count} image${count > 1 ? 's' : ''} ready for database upload.`;
        fileCountDisplay.style.color = '#3AB648';
        if (submitBtn) submitBtn.disabled = false;
      } else {
        fileCountDisplay.textContent = '';
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // Delete modal confirmation logic
  window.confirmDelete = function(recordId, deleteUrl) {
    const modalBackdrop = document.getElementById('delete-modal-backdrop');
    const deleteForm = document.getElementById('delete-form');
    const targetSpan = document.getElementById('delete-target-id');

    if (modalBackdrop && deleteForm && targetSpan) {
      deleteForm.action = deleteUrl;
      targetSpan.textContent = recordId;
      modalBackdrop.classList.add('active');
    }
  };

  window.closeDeleteModal = function() {
    const modalBackdrop = document.getElementById('delete-modal-backdrop');
    if (modalBackdrop) {
      modalBackdrop.classList.remove('active');
    }
  };

  // Close delete modal on backdrop click
  const modalBackdrop = document.getElementById('delete-modal-backdrop');
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) {
        window.closeDeleteModal();
      }
    });
  }

  // Close delete modal on Escape key press
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      window.closeDeleteModal();
    }
  });

  // Auto-dismiss flash alerts after 6 seconds with smooth fade
  document.querySelectorAll('.alert').forEach(alertEl => {
    setTimeout(() => {
      alertEl.classList.add('fade-out');
      setTimeout(() => {
        alertEl.remove();
      }, 400);
    }, 6000);
  });
});
