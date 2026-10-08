(function () {
  let ready = false;
  let pending = null;

  function revealLoadingShell() {
    document.body?.classList.remove('landing-only-mode', 'model3d-view-active', 'course-workbench-active');
    document.body?.classList.add('map-view-active');
    const layout = document.getElementById('mainLayout');
    layout?.classList.remove('mode-overview', 'is-view-switching');
    layout?.classList.add('mode-map');
    document.getElementById('overviewView')?.classList.remove('active');
    document.getElementById('model3dView')?.classList.remove('active');
    document.getElementById('plan2dView')?.classList.add('active');
    const loading = document.getElementById('map2dLoading');
    if (loading) {
      loading.hidden = false;
      const label = loading.querySelector('strong');
      if (label) label.textContent = '正在进入平台…';
    }
  }

  window.__homepageEntryBootstrap = {
    isReady: () => ready,
    hasPending: () => pending !== null,
    resume() {
      ready = true;
      const event = pending;
      pending = null;
      if (event) window.dispatchEvent(event);
    }
  };

  window.addEventListener('message', (event) => {
    if (ready || event.data?.type !== 'village-home-enter') return;
    const frame = document.getElementById('homeLandingFrame');
    if (!frame || event.source !== frame.contentWindow) return;
    pending = event;
    revealLoadingShell();
  });
})();
