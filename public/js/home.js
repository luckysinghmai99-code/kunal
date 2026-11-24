// Homepage: prompt hand-off to the dashboard and package preview.
(function () {
  'use strict';
  var RD = window.RD;
  RD.home = function () {
    var box = RD.$('#home-prompt');
    var start = RD.$('#start-creating');
    RD.$all('.chip[data-fill]').forEach(function (chip) {
      chip.addEventListener('click', function () { box.value = chip.getAttribute('data-fill'); box.focus(); });
    });
    function handoff(e) {
      var text = box.value.trim();
      if (text) localStorage.setItem('rd-pending-prompt', text);
      if (!text) { e.preventDefault(); RD.toast('Describe your project first, or pick a starter chip.'); }
    }
    start.addEventListener('click', handoff);
    RD.renderPackages(RD.$('#home-packages'));
  };
})();
