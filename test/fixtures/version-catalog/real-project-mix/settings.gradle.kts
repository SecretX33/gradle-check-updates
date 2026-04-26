@file:Suppress("UnstableApiUsage")

rootProject.name = "example-project"

plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "0.8.0"
}

// Core shared library
include(":app:common")

// Web application modules
include(":app:web:m1-data")
include(":app:web:m2-core")
include(":app:web:m2-services")
include(":app:web:m10-api")

// Content management modules
include(":app:content:m1-data")
include(":app:content:m2-services")
include(":app:content:m5-api")

// Supply modules
include(":app:supply:m1-data")
include(":app:supply:m2-services")
include(":app:supply:m5-api")

// AI/ML modules
include(":app:ai:m1-data")
include(":app:ai:m2-services")
include(":app:ai:m5-api")

// Admin module
include(":app:web:admin")

// Enable Gradle features for better build performance
enableFeaturePreview("TYPESAFE_PROJECT_ACCESSORS")
enableFeaturePreview("STABLE_CONFIGURATION_CACHE")
enableFeaturePreview("GROOVY_COMPILATION_AVOIDANCE")

// Configure repository settings
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)

    // Enable version catalog
    versionCatalogs {
        create("libs") {
            from(files("gradle/libs/versions.toml"))
        }
    }

    // Optimize repository order - most used repositories first
    repositories {
        mavenCentral() // Most dependencies come from here, list first
        mavenLocal()
    }
}

// Configure local build cache
buildCache {
    local {
        isEnabled = true
        directory = File(rootDir, "build-cache")
        // removeUnusedEntriesAfterDays = 30  // Deprecated property - removed
    }
    // Uncomment and configure for CI/CD environments if needed
    // remote(HttpBuildCache) {
    //     url = uri("https://your-build-cache-server.com/")
    //     isPush = false  // Only CI server should push to remote cache
    // }
}

// NOTE: Cache retention is now configured in an init script at ~/.gradle/init.d/cache-settings.gradle.kts
