export function parseConfiguration(configuration = '{}') {
    try {
        const decoded = decodeURIComponent(configuration);
        return JSON.parse(decoded);
    } catch {
        try {
            return JSON.parse(configuration);
        } catch {
            return {};
        }
    }
}
