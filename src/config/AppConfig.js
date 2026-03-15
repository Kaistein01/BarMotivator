const fs = require('fs');
const path = require('path');

class AppConfig {
    static getCategories() {
        if (!this.categories) {
            const categoriesPath = path.join(__dirname, '..', '..', 'categories.json');
            this.categories = JSON.parse(fs.readFileSync(categoriesPath, 'utf-8'));
        }
        return this.categories;
    }

    static getValidCategoryNames() {
        return new Set(this.getCategories().map(c => c.name));
    }
}

module.exports = AppConfig;
