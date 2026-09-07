document.querySelectorAll('.current-year').forEach((yearElement) => {
	yearElement.textContent = new Date().getFullYear();
});