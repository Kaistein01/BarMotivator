const AppConfig = require('../src/config/AppConfig');

describe('AppConfig', () => {
    it('should correctly load and return categories array', () => {
        const categories = AppConfig.getCategories();
        expect(Array.isArray(categories)).toBe(true);
        expect(categories.length).toBeGreaterThan(0);
        expect(categories[0]).toHaveProperty('name');
        expect(categories[0]).toHaveProperty('color');
    });

    it('should return a Set of valid category names', () => {
        const validNames = AppConfig.getValidCategoryNames();
        expect(validNames instanceof Set).toBe(true);
        expect(validNames.size).toBeGreaterThan(0);
        expect(validNames.has('alpha')).toBe(true);
    });

    it('should cache categories and not read file again', () => {
        const firstCall = AppConfig.getCategories();
        const secondCall = AppConfig.getCategories();
        expect(firstCall).toBe(secondCall); // Should be exact same reference
    });
});
