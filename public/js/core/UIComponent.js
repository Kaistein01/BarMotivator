/**
 * Base UI Component class demonstrating inheritance.
 */
export class UIComponent {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`UIComponent: Container #${containerId} not found.`);
        }
    }

    /**
     * Re-renders the component. Must be overridden by child classes.
     */
    render() {
        throw new Error("UIComponent.render() must be implemented by subclass.");
    }
}
