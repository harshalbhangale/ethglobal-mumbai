/*
 * Copyright (C) 2022-2025 The FlorisBoard Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

rootProject.name = "FlorisBoard"

pluginManagement {
    repositories {
        gradlePluginPortal()
        google()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
        // Uncomment the following if testing snapshots from Maven Central
        maven("https://central.sonatype.com/repository/maven-snapshots/")
        // Uncomment the following if testing snapshots from Maven Local
        // mavenLocal()
    }

    versionCatalogs {
        create("tools") {
            from(files("gradle/tools.versions.toml"))
        }
    }
}
enableFeaturePreview("TYPESAFE_PROJECT_ACCESSORS")

include(":app")
//include(":benchmark")
include(":lib:android")
include(":lib:color")
include(":lib:compose")
include(":lib:kotlin")
include(":lib:native")
include(":lib:snygg")

// Kallr: FlorisBoard v0.5.2 pins a jetpref snapshot (20251119T222500Z) that Maven
// Central has since expired. vendor/jetpref is jetpref at the commit that snapshot was
// built from (patrickgold/jetpref d6e12dd, Apache-2.0), built in place of the download.
includeBuild("vendor/jetpref") {
    dependencySubstitution {
        substitute(module("dev.patrickgold.jetpref:jetpref-datastore-model")).using(project(":datastore-model"))
        substitute(module("dev.patrickgold.jetpref:jetpref-datastore-model-processor")).using(project(":datastore-model-processor"))
        substitute(module("dev.patrickgold.jetpref:jetpref-datastore-ui")).using(project(":datastore-ui"))
        substitute(module("dev.patrickgold.jetpref:jetpref-material-ui")).using(project(":material-ui"))
    }
}
