import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.spring.dependency.management)
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.jpa)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.allopen)
    id("java-test-fixtures")
}

group = "com.example.supply.data"
version = "1.0.0-SNAPSHOT"

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

dependencies {
    implementation(project(":app:common"))

    // Spring Boot
    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.validation)
    annotationProcessor(libs.spring.boot.configuration.processor)

    // Database
    implementation(libs.postgresql)
    implementation(libs.liquibase.core)

    // Serialization
    implementation(libs.hypersistence.utils)

    // Kotlin
    implementation(libs.kotlin.stdlib)
    implementation(libs.kotlin.reflect)

    // Test Dependencies
    testImplementation(libs.spring.security.test)
    testImplementation(libs.h2)
    testImplementation(libs.mockk)
    testImplementation(libs.kotlin.test.junit5)
    testImplementation(libs.assertj.core)

    testFixturesImplementation(libs.kotlin.stdlib)
    testFixturesImplementation(libs.jakarta.persistence.api)
}

allOpen {
    annotation("jakarta.persistence.Entity")
    annotation("org.springframework.stereotype.Component")
    annotation("org.springframework.stereotype.Repository")
}

tasks.jar {
    enabled = true
    archiveBaseName.set("supply-data")
    archiveClassifier.set("")
}

tasks.bootJar {
    enabled = false
}

tasks.withType<KotlinCompile>().configureEach {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
    }
    outputs.cacheIf { true }
}
