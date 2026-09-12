import { Application } from "@hotwired/stimulus"
import { preparePage } from "./page.js"
import WebloteryController from "./controller.js"

await preparePage()

const application = Application.start()
application.register("weblotery", WebloteryController)

window.Stimulus = application
