document.addEventListener('DOMContentLoaded', function () {
  // 汉堡菜单（全屏）
  const menuToggle = document.getElementById('menuToggle');
  const menuClose = document.getElementById('menuClose');
  const mobileMenu = document.getElementById('mobileMenu');

  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      mobileMenu.classList.add('show');
      document.body.style.overflow = 'hidden';
    });
  }

  if (menuClose && mobileMenu) {
    menuClose.addEventListener('click', function () {
      mobileMenu.classList.remove('show');
      document.body.style.overflow = '';
    });
  }

  // 点菜单里的链接后自动关闭
  if (mobileMenu) {
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', function () {
        mobileMenu.classList.remove('show');
        document.body.style.overflow = '';
      });
    });
  }

  // 顶部搜索按钮
  const searchToggle = document.getElementById('searchToggle');
  if (searchToggle) {
    searchToggle.addEventListener('click', function () {
      window.location.href = '/posts?focus=1';
    });
  }

  // 文章列表页搜索
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  if (searchInput) {
    searchInput.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSearch();
      }
    });
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('focus')) {
      searchInput.focus();
      searchInput.select();
    }
  }
  if (searchBtn) searchBtn.addEventListener('click', doSearch);

  // 通用确认框
  document.querySelectorAll('form[data-confirm]').forEach(form => {
    form.addEventListener('submit', function (e) {
      if (!confirm(form.dataset.confirm)) e.preventDefault();
    });
  });
  document.querySelectorAll('button[data-confirm], a[data-confirm]').forEach(el => {
    el.addEventListener('click', function (e) {
      if (!confirm(el.dataset.confirm)) e.preventDefault();
    });
  });
});

function doSearch() {
  const input = document.getElementById('searchInput');
  if (!input) return;
  const keyword = input.value.trim();
  window.location.href = keyword ? '/posts?search=' + encodeURIComponent(keyword) : '/posts';
}

// ==================== 轮播（无界平移） ====================
let currentSlide = 0;
let trackIndex = 1;
let slides = [];
let dots = [];
let track = null;
let autoPlayInterval = null;
let isTransitioning = false;
let isResetting = false;

const TRANSITION_MS = 500;
const TRANSITION_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
const AUTOPLAY_MS = 5000;

function setTrackTransform(index, animate) {
  if (!track) return;
  if (animate) {
    track.style.transition = 'transform ' + TRANSITION_MS + 'ms ' + TRANSITION_EASING;
  } else {
    track.style.transition = 'none';
  }
  track.style.transform = 'translateX(-' + (index * 100) + '%)';
}

document.addEventListener('DOMContentLoaded', function () {
  track = document.getElementById('carouselTrack');
  if (!track) return;

  const realSlides = track.querySelectorAll('.carousel-slide');
  if (realSlides.length === 0) return;
  if (realSlides.length === 1) {
    track.style.transform = 'translateX(0)';
    return;
  }

  // 克隆首尾，实现无界平移
  const firstClone = realSlides[0].cloneNode(true);
  const lastClone = realSlides[realSlides.length - 1].cloneNode(true);
  firstClone.classList.add('clone');
  lastClone.classList.add('clone');
  track.appendChild(firstClone);
  track.insertBefore(lastClone, track.firstChild);

  slides = track.querySelectorAll('.carousel-slide');
  dots = document.querySelectorAll('.dot');

  // 初始位置：从克隆后的真实第一张开始
  setTrackTransform(1, false);
  // 强制 reflow 后再启用 transition
  void track.offsetWidth;
  setTimeout(function () {
    setTrackTransform(1, true);
  }, 50);

  const prevBtn = document.getElementById('carouselPrev');
  const nextBtn = document.getElementById('carouselNext');
  if (prevBtn) prevBtn.addEventListener('click', function () { moveSlide(-1); });
  if (nextBtn) nextBtn.addEventListener('click', function () { moveSlide(1); });

  dots.forEach(function (dot, i) {
    dot.addEventListener('click', function () { goToSlide(i); });
  });

  // 关键修复 1：只处理 track 自己的 transform 事件，过滤子元素冒泡
  track.addEventListener('transitionend', function (e) {
    if (e.target !== track) return;
    if (e.propertyName !== 'transform') return;

    const atRightClone = (trackIndex === slides.length - 1);
    const atLeftClone = (trackIndex === 0);

    if (atRightClone || atLeftClone) {
      // 关键修复 2：重置窗口期锁住点击
      isResetting = true;

      if (atRightClone) {
        trackIndex = 1;
      } else {
        trackIndex = slides.length - 2;
      }

      setTrackTransform(trackIndex, false);
      // 强制 reflow
      void track.offsetWidth;

      setTimeout(function () {
        setTrackTransform(trackIndex, true);
        isResetting = false;
        isTransitioning = false;
      }, 50);
    } else {
      isTransitioning = false;
    }
  });

  updateDots(0);
  startAutoPlay();

  const wrapper = track.closest('.carousel-wrapper');
  if (wrapper) {
    wrapper.addEventListener('mouseenter', stopAutoPlay);
    wrapper.addEventListener('mouseleave', startAutoPlay);
  }

  // 关键修复 3：页面可见性变化时暂停/恢复，防止 setInterval 累积执行
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stopAutoPlay();
    } else {
      // 强制中断状态，重置到安全位置
      isTransitioning = false;
      isResetting = false;
      trackIndex = 1;
      setTrackTransform(1, false);
      void track.offsetWidth;
      setTimeout(function () {
        setTrackTransform(1, true);
        startAutoPlay();
      }, 50);
      updateDots(0);
      currentSlide = 0;
    }
  });
});

function moveSlide(direction) {
  if (isTransitioning || isResetting) return;

  // 关键修复 4：越界直接拒绝，交给 transitionend 处理
  const nextIndex = trackIndex + direction;
  if (nextIndex < 0 || nextIndex > slides.length - 1) return;

  isTransitioning = true;
  trackIndex = nextIndex;

  setTrackTransform(trackIndex, true);

  let realIndex;
  if (trackIndex === 0) {
    realIndex = slides.length - 3;
  } else if (trackIndex === slides.length - 1) {
    realIndex = 0;
  } else {
    realIndex = trackIndex - 1;
  }
  currentSlide = realIndex;
  updateDots(realIndex);

  // 关键修复 5：用户手动操作后重置 autoplay 计时
  startAutoPlay();
}

function goToSlide(realIndex) {
  if (isTransitioning || isResetting) return;

  isTransitioning = true;
  trackIndex = realIndex + 1;

  setTrackTransform(trackIndex, true);

  currentSlide = realIndex;
  updateDots(realIndex);

  startAutoPlay();
}

function updateDots(realIndex) {
  if (dots) {
    dots.forEach(function (dot, i) {
      dot.classList.toggle('active', i === realIndex);
    });
  }
}

function startAutoPlay() {
  if (autoPlayInterval) clearInterval(autoPlayInterval);
  autoPlayInterval = setInterval(function () {
    moveSlide(1);
  }, AUTOPLAY_MS);
}

function stopAutoPlay() {
  if (autoPlayInterval) {
    clearInterval(autoPlayInterval);
    autoPlayInterval = null;
  }
}