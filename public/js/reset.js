// Password reset: read the single-use token from the link.
(function () {
  'use strict';
  var token = new URLSearchParams(window.location.search).get('token') || '';
  var field = document.getElementById('reset-token');
  if (field) field.value = token;
  if (!token) {
    var msg = document.querySelector('.form-msg');
    if (msg) { msg.textContent = 'This link is missing its token. Request a new reset link.'; msg.className = 'form-msg error'; }
  }
})();
