(function (root) {
  const shenjing = Object.freeze({
    url: "assets/basemaps/shenjing-20261125-v2/{z}/{x}/{y}.webp",
    bounds: Object.freeze([113.39525699615481, 23.0666230106482, 113.41128587722781, 23.084074537398763]),
    minZoom: 14,
    maxZoom: 21
  });
  root.VillageBasemapTiles = Object.freeze({
    forVillage(villageId) {
      return villageId === "412f3a07-afd2-4ccd-89be-deeca66a8219" || villageId === "shenjing"
        ? shenjing : null;
    }
  });
})(typeof window !== "undefined" ? window : globalThis);
