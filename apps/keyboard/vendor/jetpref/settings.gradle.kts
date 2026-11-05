rootProject.name = "JetPref"

pluginManagement {
    repositories {
        gradlePluginPortal()
        google()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

include(":datastore-model")
include(":datastore-model-processor")
include(":datastore-ui")
// AfterMarkets: example app not vendored
//include(":example")
include(":material-ui")
