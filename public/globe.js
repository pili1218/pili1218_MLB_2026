(function () {
  const canvas = document.getElementById("globeCanvas");
  if (!canvas || typeof d3 === "undefined") return;

  const context = canvas.getContext("2d");

  function resize() {
    const container = canvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    context.scale(dpr, dpr);
    return { w, h };
  }

  let dims = resize();
  let radius = Math.min(dims.w, dims.h) / 2.2;

  const projection = d3.geoOrthographic()
    .scale(radius)
    .translate([dims.w / 2, dims.h / 2])
    .clipAngle(90);

  const path = d3.geoPath().projection(projection).context(context);

  function pointInPolygon(point, polygon) {
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  function pointInFeature(point, feature) {
    const geo = feature.geometry;
    if (geo.type === "Polygon") {
      if (!pointInPolygon(point, geo.coordinates[0])) return false;
      for (let i = 1; i < geo.coordinates.length; i++) {
        if (pointInPolygon(point, geo.coordinates[i])) return false;
      }
      return true;
    } else if (geo.type === "MultiPolygon") {
      for (const poly of geo.coordinates) {
        if (pointInPolygon(point, poly[0])) {
          let inHole = false;
          for (let i = 1; i < poly.length; i++) {
            if (pointInPolygon(point, poly[i])) { inHole = true; break; }
          }
          if (!inHole) return true;
        }
      }
      return false;
    }
    return false;
  }

  function generateDots(feature, spacing) {
    const dots = [];
    const [[minLng, minLat], [maxLng, maxLat]] = d3.geoBounds(feature);
    const step = spacing * 0.08;
    for (let lng = minLng; lng <= maxLng; lng += step) {
      for (let lat = minLat; lat <= maxLat; lat += step) {
        if (pointInFeature([lng, lat], feature)) dots.push([lng, lat]);
      }
    }
    return dots;
  }

  const allDots = [];
  let landFeatures = null;

  function render() {
    const { w, h } = dims;
    context.clearRect(0, 0, w, h);
    const scale = projection.scale();
    const sf = scale / radius;

    // Globe sphere
    context.beginPath();
    context.arc(w / 2, h / 2, scale, 0, 2 * Math.PI);
    context.fillStyle = "#000000";
    context.fill();
    context.strokeStyle = "rgba(200,16,46,0.5)";
    context.lineWidth = 1.5 * sf;
    context.stroke();

    if (!landFeatures) return;

    // Graticule
    const graticule = d3.geoGraticule()();
    context.beginPath();
    path(graticule);
    context.strokeStyle = "#ffffff";
    context.lineWidth = 0.5 * sf;
    context.globalAlpha = 0.12;
    context.stroke();
    context.globalAlpha = 1;

    // Land outlines
    context.beginPath();
    landFeatures.features.forEach(f => path(f));
    context.strokeStyle = "rgba(200,16,46,0.7)";
    context.lineWidth = 0.8 * sf;
    context.stroke();

    // Dots
    for (const [lng, lat] of allDots) {
      const p = projection([lng, lat]);
      if (!p) continue;
      if (p[0] < 0 || p[0] > w || p[1] < 0 || p[1] > h) continue;
      context.beginPath();
      context.arc(p[0], p[1], 1.1 * sf, 0, 2 * Math.PI);
      context.fillStyle = "#aaaaaa";
      context.fill();
    }
  }

  const rotation = [0, -20];
  let autoRotate = true;

  d3.timer(() => {
    if (autoRotate) {
      rotation[0] += 0.3;
      projection.rotate(rotation);
      render();
    }
  });

  // Drag to rotate
  canvas.addEventListener("mousedown", (e) => {
    autoRotate = false;
    const startX = e.clientX, startY = e.clientY;
    const r0 = [...rotation];
    const onMove = (me) => {
      rotation[0] = r0[0] + (me.clientX - startX) * 0.4;
      rotation[1] = Math.max(-90, Math.min(90, r0[1] - (me.clientY - startY) * 0.4));
      projection.rotate(rotation);
      render();
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setTimeout(() => { autoRotate = true; }, 50);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  // Scroll to zoom
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    const newScale = Math.max(radius * 0.5, Math.min(radius * 2.5, projection.scale() * factor));
    projection.scale(newScale);
    render();
  }, { passive: false });

  // Touch support
  let lastTouch = null;
  canvas.addEventListener("touchstart", (e) => {
    autoRotate = false;
    lastTouch = e.touches[0];
  });
  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (!lastTouch) return;
    const t = e.touches[0];
    rotation[0] += (t.clientX - lastTouch.clientX) * 0.4;
    rotation[1] = Math.max(-90, Math.min(90, rotation[1] - (t.clientY - lastTouch.clientY) * 0.4));
    projection.rotate(rotation);
    render();
    lastTouch = t;
  }, { passive: false });
  canvas.addEventListener("touchend", () => {
    lastTouch = null;
    setTimeout(() => { autoRotate = true; }, 50);
  });

  // Load geo data
  const loadingEl = document.getElementById("globeLoading");
  fetch("https://raw.githubusercontent.com/martynafford/natural-earth-geojson/refs/heads/master/110m/physical/ne_110m_land.json")
    .then(r => r.json())
    .then(data => {
      landFeatures = data;
      data.features.forEach(f => {
        generateDots(f, 16).forEach(d => allDots.push(d));
      });
      if (loadingEl) loadingEl.style.display = "none";
      render();
    })
    .catch(() => {
      if (loadingEl) loadingEl.textContent = "Globe unavailable";
    });

  window.addEventListener("resize", () => {
    dims = resize();
    radius = Math.min(dims.w, dims.h) / 2.2;
    projection.scale(radius).translate([dims.w / 2, dims.h / 2]);
    render();
  });
})();
