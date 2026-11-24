// Pricing page: render the token packages from the API.
(function () {
  'use strict';
  var container = document.getElementById('pricing-packages');
  if (container) window.RD.renderPackages(container);
})();
