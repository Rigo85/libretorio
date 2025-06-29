export function formatTime(seconds: number): string {
	if (isNaN(seconds) || !seconds) return "0:00";

	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.round(seconds % 60);

	const hours: string = h > 0 ? String(h).padStart(2, "0") + ":" : "";
	const minutes: string = (h > 0 || m > 0) ? String(m).padStart(2, "0") + ":" : "";
	const secs = String(s).padStart(2, "0");

	return hours + minutes + secs;
}
